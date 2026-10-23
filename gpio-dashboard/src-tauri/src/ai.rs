//! Streams generated tutorial code from OpenRouter to the renderer.

use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tokio::sync::Notify;

use crate::Emit;

const API_URL: &str = "https://openrouter.ai/api/v1/chat/completions";
const ALLOWED_MODELS: [&str; 5] = [
    "anthropic/claude-opus-4.6",
    "openai/gpt-5.4",
    "minimax/minimax-m2.5",
    "google/gemini-3.1-pro-preview",
    "x-ai/grok-4.20-multi-agent-beta",
];
const ALLOWED_THINKING: [&str; 4] = ["off", "low", "medium", "high"];
const DEFAULT_MODEL: &str = "anthropic/claude-opus-4.6";
const DEFAULT_THINKING: &str = "medium";
const MAX_PROMPT_LEN: usize = 4000;

pub struct Ai {
    emit: Emit,
    client: reqwest::Client,
    // Notified to abort the request currently streaming, if any.
    in_flight: Arc<Mutex<Option<Arc<Notify>>>>,
}

impl Ai {
    pub fn new(emit: Emit) -> Self {
        Self {
            emit,
            client: reqwest::Client::new(),
            in_flight: Arc::new(Mutex::new(None)),
        }
    }

    fn fail(&self, error: String) {
        (self.emit)("ai:error", json!({ "error": error }));
    }

    /// Validates the request and starts streaming; progress and failures reach the
    /// renderer as `ai:chunk`, `ai:done` and `ai:error` events.
    pub fn generate(&self, params: Value, api_key: impl FnOnce() -> Result<String, String>) {
        if !params.is_object() {
            return self.fail("Invalid request parameters.".into());
        }
        let prompt = params
            .get("prompt")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim();
        if prompt.is_empty() || prompt.chars().count() > MAX_PROMPT_LEN {
            return self.fail(format!("Prompt must be 1-{MAX_PROMPT_LEN} characters."));
        }
        let api_key = match api_key() {
            Ok(key) => key,
            Err(e) => {
                return self.fail(format!("Could not read the API key from the keychain: {e}"));
            }
        };
        if api_key.is_empty() {
            return self.fail("No API key configured. Please set your OpenRouter API key.".into());
        }

        let model = params
            .get("model")
            .and_then(Value::as_str)
            .filter(|m| ALLOWED_MODELS.contains(m))
            .unwrap_or(DEFAULT_MODEL);
        let thinking = params
            .get("thinkingLevel")
            .and_then(Value::as_str)
            .filter(|t| ALLOWED_THINKING.contains(t))
            .unwrap_or(DEFAULT_THINKING);

        let mut body = json!({
            "model": model,
            "stream": true,
            "messages": [
                { "role": "system", "content": system_prompt(params.get("tutorialContext")) },
                { "role": "user", "content": prompt }
            ]
        });
        if thinking != "off" {
            body["reasoning"] = json!({ "effort": thinking });
        }

        // A new request supersedes any in-flight one.
        let abort = Arc::new(Notify::new());
        if let Some(previous) = self.slot().replace(abort.clone()) {
            previous.notify_one();
        }

        let emit = self.emit.clone();
        let client = self.client.clone();
        let in_flight = self.in_flight.clone();
        tauri::async_runtime::spawn(async move {
            let outcome = tokio::select! {
                _ = abort.notified() => Ok(()),
                result = stream(&client, &emit, API_URL, &api_key, &body) => result,
            };
            match outcome {
                Ok(()) => emit("ai:done", json!({})),
                Err(error) => emit("ai:error", json!({ "error": error })),
            }
            let mut slot = in_flight.lock().unwrap_or_else(|e| e.into_inner());
            if slot
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, &abort))
            {
                *slot = None;
            }
        });
    }

    pub fn abort(&self) {
        if let Some(current) = self.slot().as_ref() {
            current.notify_one();
        }
    }

    fn slot(&self) -> std::sync::MutexGuard<'_, Option<Arc<Notify>>> {
        self.in_flight.lock().unwrap_or_else(|e| e.into_inner())
    }
}

async fn stream(
    client: &reqwest::Client,
    emit: &Emit,
    url: &str,
    api_key: &str,
    body: &Value,
) -> Result<(), String> {
    let mut response = client
        .post(url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("HTTP-Referer", "https://gpio-dashboard.app")
        .header("X-Title", "GPIO Dashboard")
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();
        let excerpt: String = text.chars().take(500).collect();
        return Err(format!("API error {status}: {excerpt}"));
    }

    // Server-sent events: one `data: {...}` JSON payload per line. Lines are split on
    // raw bytes so a multi-byte character cut across chunks is decoded whole.
    let mut buffer: Vec<u8> = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        buffer.extend_from_slice(&chunk);
        while let Some(end) = buffer.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = buffer.drain(..=end).collect();
            let line = String::from_utf8_lossy(&line);
            let Some(data) = line.trim().strip_prefix("data: ") else {
                continue;
            };
            if data == "[DONE]" {
                continue;
            }
            let Ok(parsed) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            if let Some(content) = parsed["choices"][0]["delta"]["content"].as_str() {
                if !content.is_empty() {
                    emit("ai:chunk", json!({ "content": content }));
                }
            }
        }
    }
    Ok(())
}

/// Reads `key` as display text, using `fallback` when it is absent or empty.
fn text_or(value: Option<&Value>, fallback: &str) -> String {
    match value {
        Some(Value::String(s)) if !s.is_empty() => s.clone(),
        Some(Value::Null) | Some(Value::Bool(false)) | Some(Value::String(_)) | None => {
            fallback.into()
        }
        Some(other) => other.to_string(),
    }
}

fn field(item: &Value, key: &str) -> String {
    text_or(item.get(key), "")
}

fn system_prompt(ctx: Option<&Value>) -> String {
    let empty = json!({});
    let ctx = ctx.filter(|c| c.is_object()).unwrap_or(&empty);
    let get = |key: &str| ctx.get(key);

    let components = get("components")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|c| format!("{}x {}", field(c, "quantity"), field(c, "name")))
                .collect::<Vec<_>>()
                .join(", ")
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "N/A".into());
    let wiring = get("wiring")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|w| {
                    format!(
                        "{} -> {}: {}",
                        field(w, "from"),
                        field(w, "to"),
                        field(w, "description")
                    )
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "N/A".into());
    let theory: String = text_or(get("theory"), "N/A").chars().take(2000).collect();
    let code: String = text_or(get("currentCode"), "# No code yet")
        .chars()
        .take(8000)
        .collect();

    format!(
        "You are a Python code generator for Raspberry Pi GPIO tutorials.

Tutorial: {title}
Description: {description}
Category: {category} | Difficulty: {difficulty}

Components: {components}

Wiring:
{wiring}

Theory: {theory}

Current code (user-provided):
```python
{code}
```

Rules:
- Output ONLY valid Python code, no markdown fences, no explanations
- Use import RPi.GPIO as GPIO
- Use BCM pin numbering: GPIO.setmode(GPIO.BCM)
- Always include GPIO.cleanup() in a try/finally block
- Use only the GPIO pins mentioned in the wiring above
- Keep code simple, well-commented, and educational",
        title = text_or(get("title"), "Untitled"),
        description = text_or(get("description"), "N/A"),
        category = text_or(get("category"), "N/A"),
        difficulty = text_or(get("difficulty"), "N/A"),
    )
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    use super::*;
    use crate::test_support::{capture, run};

    /// Serves one canned HTTP response, one write per entry, then returns the port.
    async fn serve(parts: Vec<Vec<u8>>) -> u16 {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tauri::async_runtime::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = vec![0u8; 8192];
            let _ = socket.read(&mut request).await;
            for part in parts {
                socket.write_all(&part).await.unwrap();
                socket.flush().await.unwrap();
                tokio::time::sleep(Duration::from_millis(40)).await;
            }
        });
        port
    }

    fn chunk(data: &[u8]) -> Vec<u8> {
        let mut out = format!("{:x}\r\n", data.len()).into_bytes();
        out.extend_from_slice(data);
        out.extend_from_slice(b"\r\n");
        out
    }

    #[test]
    fn streams_content_across_split_lines_and_split_characters() {
        run(async {
            let first =
                "data: {\"choices\":[{\"delta\":{\"content\":\"print('h\"}}]}\n\n".as_bytes();
            let second = "data: {\"choices\":[{\"delta\":{\"content\":\"é✓')\"}}]}\n\n".as_bytes();
            let cut = second.iter().position(|&b| b == 0xC3).unwrap() + 1; // inside 'é'
            let port = serve(vec![
                b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n".to_vec(),
                chunk(&first[..20]),
                chunk(&first[20..]),
                chunk(&second[..cut]),
                chunk(&second[cut..]),
                chunk(b": comment\n\ndata: {\"choices\":[{\"delta\":{}}]}\n\ndata: not-json\n\ndata: [DONE]\n\n"),
                b"0\r\n\r\n".to_vec(),
            ])
            .await;

            let (emit, events) = capture();
            let url = format!("http://127.0.0.1:{port}/v1");
            stream(&reqwest::Client::new(), &emit, &url, "key", &json!({}))
                .await
                .unwrap();
            let text: String = events
                .lock()
                .unwrap()
                .iter()
                .filter(|(event, _)| event == "ai:chunk")
                .map(|(_, payload)| payload["content"].as_str().unwrap().to_string())
                .collect();
            assert_eq!(text, "print('hé✓')");
        });
    }

    #[test]
    fn reports_http_errors_with_status_and_body() {
        run(async {
            let body = b"{\"error\":\"bad key\"}";
            let port = serve(vec![
                format!(
                    "HTTP/1.1 401 Unauthorized\r\nContent-Length: {}\r\n\r\n",
                    body.len()
                )
                .into_bytes(),
                body.to_vec(),
            ])
            .await;
            let (emit, _) = capture();
            let url = format!("http://127.0.0.1:{port}/v1");
            let error = stream(&reqwest::Client::new(), &emit, &url, "key", &json!({}))
                .await
                .unwrap_err();
            assert_eq!(error, "API error 401: {\"error\":\"bad key\"}");
        });
    }

    #[test]
    fn invalid_requests_are_rejected_before_any_network_call() {
        let (emit, events) = capture();
        let ai = Ai::new(emit);
        ai.generate(json!("not an object"), || panic!("key must not be read"));
        ai.generate(json!({"prompt": "   "}), || panic!("key must not be read"));
        ai.generate(json!({"prompt": "x".repeat(MAX_PROMPT_LEN + 1)}), || {
            panic!("key must not be read")
        });
        ai.generate(json!({"prompt": "blink an led"}), || Ok(String::new()));
        ai.generate(json!({"prompt": "blink an led"}), || Err("locked".into()));
        let errors: Vec<String> = events
            .lock()
            .unwrap()
            .iter()
            .map(|(_, payload)| payload["error"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(
            errors,
            [
                "Invalid request parameters.",
                "Prompt must be 1-4000 characters.",
                "Prompt must be 1-4000 characters.",
                "No API key configured. Please set your OpenRouter API key.",
                "Could not read the API key from the keychain: locked",
            ]
        );
    }

    #[test]
    fn system_prompt_uses_context_with_fallbacks_and_truncation() {
        let prompt = system_prompt(Some(&json!({
            "title": "Blink an LED",
            "components": [{"quantity": 2, "name": "220Ω resistor"}],
            "wiring": [{"from": "GPIO17", "to": "LED+", "description": "via resistor"}],
            "theory": "θ".repeat(2500),
        })));
        assert!(prompt.contains("Tutorial: Blink an LED"));
        assert!(prompt.contains("Description: N/A"));
        assert!(prompt.contains("Components: 2x 220Ω resistor"));
        assert!(prompt.contains("GPIO17 -> LED+: via resistor"));
        assert!(prompt.contains(&"θ".repeat(2000)));
        assert!(!prompt.contains(&"θ".repeat(2001)));
        assert!(prompt.contains("# No code yet"));
        assert!(system_prompt(None).contains("Tutorial: Untitled"));
    }
}
