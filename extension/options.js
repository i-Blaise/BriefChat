const input = document.getElementById("apiKeyInput");
const saveBtn = document.getElementById("saveBtn");
const status = document.getElementById("status");
const providerDetected = document.getElementById("providerDetected");

const PROVIDER_LABELS = {
    anthropic: "Detected: Anthropic Claude",
    gemini:    "Detected: Google Gemini",
    grok:      "Detected: xAI Grok",
    openai:    "Detected: OpenAI"
};

function detectProvider(key) {
    if (!key) return null;
    if (key.startsWith("sk-ant-")) return "anthropic";
    if (key.startsWith("AIza"))    return "gemini";
    if (key.startsWith("xai-"))    return "grok";
    if (key.startsWith("sk-"))     return "openai";
    return null;
}

function updateProviderLabel(key) {
    const provider = detectProvider(key.trim());
    providerDetected.textContent = provider ? PROVIDER_LABELS[provider] : "";
}

document.addEventListener("DOMContentLoaded", async () => {
    const data = await chrome.storage.local.get(["userApiKey", "openaiApiKey"]);

    // Migrate legacy key
    if (!data.userApiKey && data.openaiApiKey) {
        await chrome.storage.local.set({ userApiKey: data.openaiApiKey });
        await chrome.storage.local.remove("openaiApiKey");
        input.value = data.openaiApiKey;
    } else if (data.userApiKey) {
        input.value = data.userApiKey;
    }

    updateProviderLabel(input.value);
});

input.addEventListener("input", () => updateProviderLabel(input.value));

saveBtn.addEventListener("click", async () => {
    const key = input.value.trim();

    if (key && !detectProvider(key)) {
        showStatus('Unrecognized key format. Expected sk-..., sk-ant-..., AIza..., or xai-...', "error");
        return;
    }

    await chrome.storage.local.set({ userApiKey: key });
    await chrome.storage.local.remove("openaiApiKey");

    showStatus(key ? "Saved!" : "Key cleared.", "success");
    setTimeout(() => { status.textContent = ""; status.className = ""; }, 2500);
});

function showStatus(msg, type) {
    status.textContent = msg;
    status.className = type;
}
