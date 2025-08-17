# Simple LLM Chat Application using React + Vite + TS and Rust + Ollama

This is a starter package of sorts for me to build projects with Rust. Hope you enjoy!

## Motivations
- I love Python, but it seems monotonous, it is simple and straightforward; THIS was a challange!
- Rust makes you feel one with your system irrespetive of wether you are just builing a https server ir a 3D game engine
- This was my fist time trying rust for a server based backend

## Project Structure

```
ollama-chat-app/
├── ollama-chat-frontend/  # Frontend React + Vite + TS app
│   ├── public/
│   ├── src/
│   ├── index.html
│   ├── package.json
│   └── ...
├── ollama-chat-backend/   # Backend Rust server
│   ├── src/
│   │   └── main.rs
│   ├── Cargo.toml
│   └── Cargo.lock
├── .gitignore
└── README.md
```

## Features

*   **Direct Ollama Integration**: Connects directly to a running Ollama instance to stream responses from local language models.
*   **Real-time Streaming**: Responses from the language model are streamed to the UI in real-time for a responsive user experience.
*   **Chat History**: Conversations are saved to local storage, persisting between sessions.
*   **Prompt Editing**: Users can edit and resubmit their previous prompts.
*   **Performant Backend**: A robust and efficient backend server built with Rust and Axum.

## Technology Stack

*   **Frontend**: React, Vite, TypeScript, CSS
*   **Backend**: Rust, Axum, Tokio, Serde

## Prerequisites

Before you begin, ensure you have the following installed:
*   [Node.js and npm](https://nodejs.org/)
*   [Rust and Cargo](https://www.rust-lang.org/tools/install)
*   [Ollama](https://ollama.com/) with a downloaded model (e.g., `ollama run llama3:8b`)

## Getting Started

### 1. Clone the Repository

```bash
git clone https://www.github.com/snigenigmatic/ollama-chat-app.git
cd ollama-chat-app
```

### 2. Run the Backend Server

In a new terminal, navigate to the backend directory and run the server.

```bash
cd ollama-chat-backend
cargo run
```
The server will start on `http://127.0.0.1:8080`.

### 3. Run the Frontend Application

In another terminal, navigate to the frontend directory, install dependencies, and start the development server.

```bash
cd ollama-chat-frontend
npm install
npm run dev
```
The application will be available at the URL provided (usually `http://localhost:5173`).

## Example Run

<div align="center">
    <img src="./assets/ollama-chat-demo.png" alt="Ollama Chat Application Demo" width="800" />
    <p><em>Ollama Chat Application running with llama3:8b model</em></p>
</div>
