use axum::{routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use futures_util::stream::TryStreamExt;
use axum::response::IntoResponse;
use axum::response::sse::{Sse, Event};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use std::net::SocketAddr;
use tower_http::cors::{Any, CorsLayer};

#[derive(Serialize, Deserialize, Clone)]
struct Msg {
    role: String,
    content: String,
}

#[derive(Serialize, Deserialize)]
struct ChatReq {
    messages: Vec<Msg>,
    model: Option<String>,
    stream: Option<bool>,
}

// Keep structs for the expected shape, but we'll parse more flexibly below.
#[derive(Deserialize)]
struct OllamaChatMessage {
    content: String,
}

#[derive(Deserialize)]
struct OllamaChatResp {
    message: OllamaChatMessage,
}

#[derive(Serialize)]
struct ChatResp {
    content: String,
}

#[tokio::main]
async fn main() {
    let cors = CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any);

    let app = Router::new()
        .route("/api/chat", post(chat))
        .route("/api/chat/stream", post(chat_stream))
        .layer(cors);

    let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();
    println!("Server running on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn chat(Json(req): Json<ChatReq>) -> Json<ChatResp> {
    // Normalize model identifiers coming from the frontend.
    fn normalize_model(opt: Option<String>) -> String {
        match opt {
            Some(m) => {
                // common alias from frontend: "llama3.1" -> "llama3:8b"
                if m == "llama3.1" {
                    return "llama3:8b".to_string();
                }
                // If frontend sent 'llama3.8b' or similar with a dot, replace with ':'
                if m.contains('.') && !m.contains(':') {
                    return m.replace('.', ":");
                }
                m
            }
            None => "llama3:8b".to_string(),
        }
    }

    let model = normalize_model(req.model.clone());
    println!("using model: {}", model);

    let body = serde_json::json!({
        "model": model,
        "messages": req.messages,
        "stream": false
    });

    let client = reqwest::Client::new();
    let resp = match client.post("http://127.0.0.1:11434/api/chat").json(&body).send().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("failed to send request to ollama: {}", e);
            return Json(ChatResp { content: format!("Error contacting Ollama API: {}", e) });
        }
    };

    // Read the whole response body as text first so we can log/fallback if parsing fails.
    let body_text = match resp.text().await {
        Ok(t) => t,
        Err(e) => {
            eprintln!("failed to read response body: {}", e);
            return Json(ChatResp { content: format!("Failed to read response body: {}", e) });
        }
    };

    // Try to parse JSON; if invalid, return raw body so frontend can surface it.
    let json: Value = match serde_json::from_str(&body_text) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("invalid json from ollama: {}\nbody: {}", e, body_text);
            return Json(ChatResp { content: body_text });
        }
    };

    // Walk the JSON to find a `content` string (common locations: message.content or content)
    fn extract_content(v: &Value) -> Option<String> {
        match v {
            Value::String(_) => None,
            Value::Object(map) => {
                if let Some(Value::String(s)) = map.get("content") {
                    return Some(s.clone());
                }
                if let Some(msg) = map.get("message") {
                    if let Some(Value::String(s)) = msg.get("content") {
                        return Some(s.clone());
                    }
                }
                for (_k, val) in map.iter() {
                    if let Some(found) = extract_content(val) {
                        return Some(found);
                    }
                }
                None
            }
            Value::Array(arr) => {
                for val in arr.iter() {
                    if let Some(found) = extract_content(val) {
                        return Some(found);
                    }
                }
                None
            }
            _ => None,
        }
    }

    let content = extract_content(&json).unwrap_or_else(|| body_text.clone());

    Json(ChatResp { content })
}

// Streaming endpoint: proxies Ollama's streaming response to the frontend.
async fn chat_stream(Json(req): Json<ChatReq>) -> impl axum::response::IntoResponse {
    // reuse normalization
    fn normalize_model(opt: Option<String>) -> String {
        match opt {
            Some(m) => {
                if m == "llama3.1" {
                    return "llama3:8b".to_string();
                }
                if m.contains('.') && !m.contains(':') {
                    return m.replace('.', ":");
                }
                m
            }
            None => "llama3:8b".to_string(),
        }
    }

    let model = normalize_model(req.model.clone());
    println!("using model (stream): {}", model);

    let body = serde_json::json!({
        "model": model,
        "messages": req.messages,
        "stream": true
    });

    let client = reqwest::Client::new();
    let resp = match client.post("http://127.0.0.1:11434/api/chat").json(&body).send().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("failed to send request to ollama (stream): {}", e);
            // Return an SSE that immediately yields the error message as a single event.
            let (tx_err, rx_err) = mpsc::channel::<Result<Event, std::convert::Infallible>>(1);
            let _ = tx_err.send(Ok(Event::default().data(format!("Error contacting Ollama API: {}", e)))).await;
            return Sse::new(ReceiverStream::new(rx_err));
        }
    };

    if !resp.status().is_success() {
        let txt = match resp.text().await {
            Ok(t) => t,
            Err(_) => String::from("unknown error from ollama"),
        };
        // Return an SSE that immediately yields the error message as a single event.
        let (tx_err, rx_err) = mpsc::channel::<Result<Event, std::convert::Infallible>>(1);
        let _ = tx_err.send(Ok(Event::default().data(txt))).await;
        return Sse::new(ReceiverStream::new(rx_err));
    }

    // Create an mpsc channel and spawn a task that forwards bytes from reqwest into the channel as SSE events.
    let (tx, rx) = mpsc::channel::<Result<Event, std::convert::Infallible>>(16);
    let mut remote_stream = resp.bytes_stream();

    tokio::spawn(async move {
        while let Some(chunk) = remote_stream.try_next().await.transpose() {
            match chunk {
                Ok(bytes) => {
                    let s = match String::from_utf8(bytes.to_vec()) {
                        Ok(t) => t,
                        Err(_) => "".to_string(),
                    };
                    // Send as data event
                    if tx.send(Ok(Event::default().data(s))).await.is_err() {
                        break;
                    }
                }
                Err(e) => {
                    let _ = tx.send(Ok(Event::default().data(format!("__ERR__:{}", e)))).await;
                    break;
                }
            }
        }
    });

    let stream = ReceiverStream::new(rx);
    Sse::new(stream)
}
