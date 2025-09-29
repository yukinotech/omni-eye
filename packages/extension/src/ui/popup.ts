document.addEventListener("DOMContentLoaded", () => {
  const statusEl = document.getElementById("status");
  const pingButton = document.getElementById("ping-adapter");

  function render(result: unknown) {
    if (!statusEl) return;
    if (typeof result === "string") {
      statusEl.textContent = result;
      return;
    }
    try {
      statusEl.textContent = JSON.stringify(result, null, 2);
    } catch (error) {
      statusEl.textContent = String(result);
    }
  }

  function sendStatusRequest(): Promise<unknown> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: "REQUEST",
          id: "popup-adapter-status",
          cap: "adapter.status",
          payload: {}
        },
        (response) => {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            reject(new Error(lastError.message));
            return;
          }
          resolve(response);
        }
      );
    });
  }

  async function updateStatus() {
    render("Checking adapter...");
    try {
      const response = await sendStatusRequest();
      render(response);
    } catch (error) {
      render(error instanceof Error ? error.message : String(error));
    }
  }

  pingButton?.addEventListener("click", () => {
    void updateStatus();
  });

  void updateStatus();
});
