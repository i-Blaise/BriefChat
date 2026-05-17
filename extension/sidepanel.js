let pageContent = null;
let chatHistory = [];
let isLoading = false;
let currentTabId = null;
let currentUrl = null;
let freeQuestionsRemaining = null;

const freeQuestionsHintEl = document.getElementById("freeQuestionsHint");
const messagesEl = document.getElementById("messages");
const chipsEl = document.getElementById("chipsContainer");
const inputEl = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const pageTitleEl = document.getElementById("pageTitle");
const newPageBannerEl = document.getElementById("newPageBanner");
const newPageLabelEl = document.getElementById("newPageLabel");

document.addEventListener("DOMContentLoaded", async () => {
    document.getElementById("settingsBtn").addEventListener("click", () => {
        chrome.runtime.openOptionsPage();
    });

    document.getElementById("startNewBtn").addEventListener("click", async () => {
        const tabId = currentTabId;
        resetPanel();
        await initPanel(tabId);
    });

    document.getElementById("dismissBannerBtn").addEventListener("click", hideBanner);

    sendBtn.addEventListener("click", handleSend);

    inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    inputEl.addEventListener("input", autoResizeTextarea);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
        currentTabId = tab.id;
        currentUrl = tab.url || null;
    }

    await initPanel();
    registerTabListeners();
});

// ─── Tab change detection ───────────────────────────────────────────────────

function registerTabListeners() {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (tabId !== currentTabId) return;
        if (changeInfo.status !== "complete") return;

        const newUrl = tab.url || changeInfo.url;
        if (!newUrl || newUrl === currentUrl) return;

        currentUrl = newUrl;
        if (pageContent !== null) {
            showBanner(tab.title || newUrl);
        }
    });

    chrome.tabs.onActivated.addListener(async ({ tabId }) => {
        if (tabId === currentTabId) return;

        currentTabId = tabId;
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab) return;

        currentUrl = tab.url || null;
        if (pageContent !== null) {
            showBanner(tab.title || tab.url || "New tab");
        }
    });
}

function showBanner(title) {
    const label = title.length > 55 ? title.slice(0, 52) + "…" : title;
    newPageLabelEl.textContent = label;
    newPageBannerEl.hidden = false;
}

function hideBanner() {
    newPageBannerEl.hidden = true;
}

// ─── Panel lifecycle ────────────────────────────────────────────────────────

function resetPanel() {
    pageContent = null;
    chatHistory = [];
    isLoading = false;
    freeQuestionsRemaining = null;
    messagesEl.innerHTML = "";
    chipsEl.innerHTML = "";
    inputEl.value = "";
    inputEl.style.height = "auto";
    sendBtn.disabled = false;
    freeQuestionsHintEl.hidden = true;
    hideBanner();
}

// Runs inside the page context — must be self-contained (no closure references)
function extractContent() {
    const semanticRoot = document.querySelector(
        "article, main, [role='main'], .content, #content, #main"
    );
    const root = semanticRoot || document.body;
    const elements = root.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,blockquote,td,th");
    const lines = Array.from(elements)
        .map(el => el.innerText.trim())
        .filter(t => t.length > 20);
    const deduped = lines.filter((line, i) => i === 0 || line !== lines[i - 1]);
    let content = deduped.join("\n").slice(0, 12000);
    if (content.length < 200) {
        content = document.body.innerText.replace(/\s{3,}/g, "\n\n").trim().slice(0, 12000);
    }
    return { content, title: document.title, url: location.href };
}

async function getPageContent(tabId) {
    let results;
    try {
        results = await chrome.scripting.executeScript({
            target: { tabId },
            func: extractContent
        });
    } catch {
        throw new Error("restricted");
    }
    const data = results?.[0]?.result;
    if (!data?.content) throw new Error("empty");
    return data;
}

async function initPanel(tabId = null) {
    let tab;
    try {
        if (tabId) {
            tab = await chrome.tabs.get(tabId);
        } else {
            [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        }
    } catch {
        showError("Could not access the current tab.");
        return;
    }

    currentTabId = tab.id;
    currentUrl = tab.url || null;

    pageTitleEl.textContent = tab.title
        ? (tab.title.length > 70 ? tab.title.slice(0, 67) + "…" : tab.title)
        : tab.url;

    try {
        pageContent = await getPageContent(tab.id);
    } catch (e) {
        if (e.message === "restricted") {
            showError("This page cannot be analyzed. Navigate to a regular webpage and click \"Start new chat here\".");
        } else {
            showError("Couldn't extract content from this page. It may still be loading — try again in a moment.");
        }
        return;
    }

    const loadingBubble = appendMessage("ai", null, true);

    chrome.runtime.sendMessage(
        {
            type: "ANALYZE_PAGE",
            pageContent: pageContent.content,
            pageTitle: pageContent.title,
            pageUrl: pageContent.url
        },
        (response) => {
            loadingBubble.remove();

            if (!response || !response.success) {
                appendMessage("ai", `Error: ${response?.error || "Something went wrong."}`, false, true);
                return;
            }

            appendMessage("ai", response.summary);
            renderChips(response.suggestedQuestions);
        }
    );
}

// ─── UI helpers ─────────────────────────────────────────────────────────────

function appendMessage(role, text, loading = false, isError = false) {
    const el = document.createElement("div");
    el.classList.add("message", role);
    if (loading) el.classList.add("loading");
    if (isError) el.classList.add("error");
    if (text) el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
}

function renderChips(questions) {
    chipsEl.innerHTML = "";
    if (!questions || !questions.length) return;
    questions.forEach((q) => {
        const btn = document.createElement("button");
        btn.className = "chip";
        btn.textContent = q;
        btn.addEventListener("click", () => sendUserMessage(q));
        chipsEl.appendChild(btn);
    });
}

function handleSend() {
    const text = inputEl.value.trim();
    if (!text || isLoading) return;
    inputEl.value = "";
    autoResizeTextarea();
    sendUserMessage(text);
}

function sendUserMessage(text) {
    if (isLoading || !pageContent) return;

    hideBanner();
    chipsEl.innerHTML = "";
    isLoading = true;
    sendBtn.disabled = true;

    appendMessage("user", text);
    chatHistory.push({ role: "user", content: text });

    const loadingBubble = appendMessage("ai", null, true);

    chrome.runtime.sendMessage(
        {
            type: "CHAT_MESSAGE",
            history: chatHistory,
            pageContent: pageContent.content,
            pageTitle: pageContent.title,
            pageUrl: pageContent.url
        },
        (response) => {
            isLoading = false;
            sendBtn.disabled = false;
            loadingBubble.remove();

            if (!response || !response.success) {
                const err = response?.error;
                if (err === "RATE_LIMIT") {
                    appendMessage("ai", "You've used your 3 free questions today. Add your own API key in Settings to keep chatting.", false, true);
                    updateRemainingDisplay(0);
                } else {
                    appendMessage("ai", `Error: ${err || "Something went wrong."}`, false, true);
                }
                chatHistory.pop();
                return;
            }

            appendMessage("ai", response.reply);
            chatHistory.push({ role: "assistant", content: response.reply });

            if (response.remaining !== undefined) {
                updateRemainingDisplay(response.remaining);
            }
        }
    );
}

function showError(message) {
    appendMessage("ai", message, false, true);
}

function updateRemainingDisplay(remaining) {
    freeQuestionsRemaining = remaining;
    if (remaining === null || remaining === undefined) {
        freeQuestionsHintEl.hidden = true;
        return;
    }
    freeQuestionsHintEl.hidden = false;
    if (remaining === 0) {
        freeQuestionsHintEl.textContent = "No free questions left today — add your API key in Settings to keep chatting.";
    } else {
        freeQuestionsHintEl.textContent = `${remaining} free question${remaining === 1 ? "" : "s"} left today`;
    }
}

function autoResizeTextarea() {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
}
