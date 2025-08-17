import { useState, useRef, useEffect } from "react";
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ReactMarkdown from 'react-markdown';
import "./App.css";

type Msg = { role: string; content: string };

function CodeBlock({ language, code }: { language: string, code: string }) {
  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span>{language || 'code'}</span>
        <button
          onClick={() => navigator.clipboard.writeText(code)}
          className="copy-btn"
        >
          Copy
        </button>
      </div>
      <SyntaxHighlighter language={language} style={vscDarkPlus} customStyle={{ margin: 0, borderRadius: '0 0 8px 8px' }} PreTag="div">
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

export default function App() {
  const [messages, setMessages] = useState<Msg[]>(() => {
    const saved = localStorage.getItem("chatHistory");
    return saved ? JSON.parse(saved) : [];
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const bufferRef = useRef("");
  const flushTimerRef = useRef<number | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    localStorage.setItem("chatHistory", JSON.stringify(messages));
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  function startEdit(index: number) {
    if (busy) return;
    const messageToEdit = messages[index];
    if (messageToEdit.role === 'user') {
      setInput(messageToEdit.content);
      setEditingIndex(index);
    }
  }

  async function send() {
    if (!input.trim() || busy) return;
    
    let nextMessages: Msg[];
    if (editingIndex !== null) {
      // We are editing a message. We'll replace the user message
      // and remove all subsequent messages.
      nextMessages = messages.slice(0, editingIndex + 1);
      nextMessages[editingIndex] = { ...nextMessages[editingIndex], content: input };
    } else {
      // It's a new message.
      nextMessages = [...messages, { role: "user", content: input }];
    }

    setMessages(nextMessages);
    setInput("");
    setBusy(true);
    setEditingIndex(null);

    try {
      const controller = new AbortController();
      controllerRef.current = controller;
      bufferRef.current = "";
      if (flushTimerRef.current) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }

      const res = await fetch("http://127.0.0.1:8080/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, model: "llama3.1" }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        const assistantMsg: Msg = { role: "assistant", content: `Error: ${res.status} ${res.statusText} - ${text}` };
        setMessages([...nextMessages, assistantMsg]);
        setBusy(false);
        return;
      }

      const assistantIndex = nextMessages.length;
      setMessages([...nextMessages, { role: "assistant", content: "" }]);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;

      const flushBuffer = () => {
        const txt = bufferRef.current;
        if (!txt) return;
        setMessages(prev => {
          const copy = prev.slice();
          copy[assistantIndex] = { role: "assistant", content: (copy[assistantIndex]?.content || "") + txt };
          return copy;
        });
        bufferRef.current = "";
        if (flushTimerRef.current) {
          window.clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
      };

      while (!done) {
        const { value, done: streamDone } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          while (true) {
            const idx = buffer.indexOf("\n\n");
            if (idx === -1) break;
            const rawEvent = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const lines = rawEvent.split(/\r?\n/);
            const dataLines = lines.filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).join("\n");
            let data = dataLines.trim();
            while (data.startsWith("data:")) data = data.slice(5).trim();
            if (!data) continue;
            if (data.startsWith("__ERR__:") || data.toLowerCase().startsWith("error")) {
              bufferRef.current += `\n[error] ${data}`;
            } else {
              try {
                const obj = JSON.parse(data);
                const msg = obj?.message?.content;
                if (typeof msg === 'string' && msg.length > 0) {
                  bufferRef.current += msg;
                }
                if (obj?.done === true) {
                  flushBuffer();
                  done = true;
                  break;
                }
              } catch (e) {
                bufferRef.current += data;
              }
            }
            if (!flushTimerRef.current) {
              flushTimerRef.current = window.setTimeout(() => flushBuffer(), 80);
            }
          }
        }
        if (streamDone) done = true;
      }

    } catch (e: any) {
      const isAbort = e?.name === 'AbortError' || e?.message?.toLowerCase()?.includes('aborted');
      const assistantMsg: Msg = { role: "assistant", content: isAbort ? "[cancelled]" : `Network error: ${e?.message ?? String(e)}` };
      setMessages(prev => [...prev.slice(0, nextMessages.length), assistantMsg]);
    } finally {
      setBusy(false);
      controllerRef.current = null;
      if (flushTimerRef.current) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    }
  }

  function cancel() {
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
    if (flushTimerRef.current) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    setBusy(false);
  }

  return (
    <div className="app-container">
        <div className="app-header">
          <div className="app-title">Ollama Chat</div>
          <div className="app-sub">Local LLM playground</div>
        </div>
        <div ref={chatRef} className="chat-window">
          {messages.map((m, i) => (
            <div key={i} className={`message-row ${m.role === "user" ? "from-user" : "from-assistant"}`}>
              <div className={`message-bubble ${m.role === "user" ? "user" : "assistant"}`}>
                {m.content.includes('```') ? (
                  m.content.split(/```([a-zA-Z0-9]*)\n?([\s\S]*?)```/).map((part, idx) => {
                    if (idx % 3 === 0) return <ReactMarkdown key={idx}>{part}</ReactMarkdown>;
                    if (idx % 3 === 1) return null; // This is the language identifier, we'll use it in the next part
                    const lang = m.content.split(/```([a-zA-Z0-9]*)\n?([\s\S]*?)```/)[idx - 1];
                    return <CodeBlock key={idx} language={lang} code={part} />;
                  })
                ) : (
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                )}
                 {m.role === 'user' && !busy && (
                  <button onClick={() => startEdit(i)} className="edit-btn" title="Edit">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" /></svg>
                  </button>
                )}
                <button 
                  onClick={() => navigator.clipboard.writeText(m.content)} 
                  className="message-copy-btn" 
                  title="Copy message"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                    <path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.121A1.5 1.5 0 0117 6.621V16.5a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 017 16.5v-13z" />
                    <path d="M4.5 6A1.5 1.5 0 003 7.5v9A1.5 1.5 0 004.5 18h7a1.5 1.5 0 001.5-1.5v-2.25a.75.75 0 00-1.5 0v2.25a.5.5 0 01-.5.5h-7a.5.5 0 01-.5-.5v-9a.5.5 0 01.5-.5h2.25a.75.75 0 000-1.5H4.5z" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
          {busy && (
            <div className="thinking-indicator">
              <span>AI is thinking...</span>
            </div>
          )}
        </div>
          <div className="input-row">
          <input
            className="input-area"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" ? send() : null}
            placeholder={editingIndex !== null ? "Edit your prompt..." : "Ask anything"}
          />
            <div className="controls">
              <button
                onClick={send}
                disabled={busy || !input.trim()}
                className="send-btn"
                title={editingIndex !== null ? "Update" : "Send"}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.949a.75.75 0 00.95.544l3.252-.928A.75.75 0 009 8.252v.021l-3.252.928a.75.75 0 00-.95.544l-1.414 4.949a.75.75 0 00.826.95l13.238-3.782a.75.75 0 000-1.418L3.105 2.289z" />
                </svg>
              </button>
              {busy && (
                <button
                  onClick={cancel}
                  className="cancel-btn"
                  title="Cancel"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                  </svg>
                </button>
              )}
            </div>
          </div>
      </div>
  );
}
