//! Helpers shared by the tests: capture emitted events and run async code.

use std::sync::{Arc, Mutex};

use serde_json::Value;

use crate::Emit;

pub type Events = Arc<Mutex<Vec<(String, Value)>>>;

/// An `Emit` that records every event instead of sending it to a webview.
pub fn capture() -> (Emit, Events) {
    let events: Events = Default::default();
    let sink = events.clone();
    let emit: Emit = Arc::new(move |event, payload| {
        sink.lock().unwrap().push((event.to_string(), payload));
    });
    (emit, events)
}

pub fn run<F: std::future::Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

pub async fn wait_for(what: &str, mut condition: impl FnMut() -> bool) {
    for _ in 0..100 {
        if condition() {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    panic!("timed out waiting for {what}");
}
