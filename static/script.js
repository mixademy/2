document.addEventListener('DOMContentLoaded', () => {
    const chatList = document.getElementById('chat-list');
    const newChatBtn = document.getElementById('new-chat-btn');
    const messagesContainer = document.getElementById('messages-container');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const currentChatTitle = document.getElementById('current-chat-title');
    const modelSelector = document.getElementById('model-selector') || { value: 'smart' };

    const fileUploadInput = document.getElementById('file-upload');
    const filePreviewContainer = document.getElementById('file-preview-container');
    const filePreviewName = document.getElementById('file-preview-name');
    const removeFileBtn = document.getElementById('remove-file-btn');
    const filePreviewLoading = document.getElementById('file-preview-loading');

    let currentChatId = null;
    let abortController = null;
    let attachedFileData = null;

    const settingsBtn = document.getElementById('open-settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const saveSettingsBtn = document.getElementById('save-settings-btn');
    const themeSelect = document.getElementById('theme-select');
    const languageSelect = document.getElementById('language-select');

    if (localStorage.getItem('orion_theme') === 'light') {
        document.body.classList.add('light-mode');
        if (themeSelect) themeSelect.value = 'light';
    } else {
        if (themeSelect) themeSelect.value = 'dark';
    }

    if (localStorage.getItem('orion_language') && languageSelect) {
        languageSelect.value = localStorage.getItem('orion_language');
    }

    if (settingsBtn) settingsBtn.onclick = () => settingsModal.style.display = 'flex';
    if (closeSettingsBtn) closeSettingsBtn.onclick = () => settingsModal.style.display = 'none';

    if (saveSettingsBtn) {
        saveSettingsBtn.onclick = () => {
            const selectedTheme = themeSelect.value;
            localStorage.setItem('orion_theme', selectedTheme);
            if (selectedTheme === 'light') document.body.classList.add('light-mode');
            else document.body.classList.remove('light-mode');

            localStorage.setItem('orion_language', languageSelect.value);

            const originalText = saveSettingsBtn.innerHTML;
            saveSettingsBtn.innerHTML = '<i class="fas fa-check"></i> Elmentve!';
            saveSettingsBtn.style.background = '#4ade80';

            setTimeout(() => {
                saveSettingsBtn.innerHTML = originalText;
                saveSettingsBtn.style.background = '';
                settingsModal.style.display = 'none';
            }, 1000);
        };
    }

    // --- HAMBURGER MENÜ LOGIKA ---
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const closeMenuBtn = document.getElementById('close-menu-btn');
    const sidebar = document.querySelector('.sidebar');
    const mobileOverlay = document.getElementById('mobile-overlay');

    function toggleMobileMenu(show) {
        sidebar.classList.toggle('open', show);
        if (mobileOverlay) mobileOverlay.classList.toggle('active', show);
    }

    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.innerWidth > 768) {
                sidebar.classList.toggle('desktop-collapsed');
            } else {
                toggleMobileMenu(true);
            }
        });
    }
    
    if (closeMenuBtn) closeMenuBtn.addEventListener('click', () => toggleMobileMenu(false));
    if (mobileOverlay) mobileOverlay.addEventListener('click', () => toggleMobileMenu(false));
    document.addEventListener('click', (e) => { 
        if (window.innerWidth <= 768 && sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== mobileMenuBtn && !mobileMenuBtn.contains(e.target)) {
            toggleMobileMenu(false);
        }
    });

    // --- KÓD MÁSOLÁSA GOMB FUNKCIÓ ---
    window.copyCode = function(btn) {
        // Megkeressük a gombhoz tartozó <pre><code> elemet
        const pre = btn.closest('.code-block-wrapper').querySelector('.code-content code');
        navigator.clipboard.writeText(pre.innerText).then(() => {
            const originalHTML = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check"></i> Másolva!';
            setTimeout(() => { btn.innerHTML = originalHTML; }, 2000);
        });
    };

    // --- MARKDOWN ÉRTELMEZŐ (Kód, Vastagítás, Képek) ---
    function formatMessageContent(content) {
        // 1. Megvédjük a HTML tageket (XSS védelem)
        let html = content.replace(/</g, "&lt;").replace(/>/g, "&gt;");

        // 2. Vastagított szöveg formázása: **szöveg**
        html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

        // 3. Kódblokkok formázása (gyönyörű sötét doboz, másolás gombbal)
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function(match, lang, code) {
            const language = lang ? lang.toUpperCase() : 'KÓD';
            return `<div class="code-block-wrapper">
                        <div class="code-header">
                            <span class="code-lang">${language}</span>
                            <button class="copy-btn" onclick="copyCode(this)"><i class="fas fa-copy"></i> Másolás</button>
                        </div>
                        <pre class="code-content"><code>${code}</code></pre>
                    </div>`;
        });

        // 4. Egysoros kódok (inline code)
        html = html.replace(/`([^`]+)`/g, "<code class='inline-code'>$1</code>");

        // 5. Generált képek (plusz letöltés gombbal!)
        html = html.replace(/!\[([^\]]*)\]\s*\(?([^)\s<]+)\)?/g, `<div class="img-wrapper">
            <div class="img-loading"><i class="fas fa-circle-notch fa-spin"></i> Generálás...</div>
            <img src="$2" alt="$1" class="chat-img" onload="this.style.display='block'; this.previousElementSibling.style.display='none'; this.parentElement.style.border='none'; this.parentElement.style.background='transparent'; this.nextElementSibling.style.display='flex';">
            <a href="$2" download="orion_image" target="_blank" class="download-img-btn" style="display:none;" title="Kép letöltése"><i class="fas fa-download"></i></a>
        </div>`);

        return html;
    }

    // --- KEZDŐKÉPERNYŐ KÖZÉPRE IGAZÍTÁSA ---
    function showWelcomeScreen() {
        currentChatTitle.innerHTML = '<i class="fas fa-sparkles"></i> Orion AI';
        messagesContainer.innerHTML = `<div class="welcome-screen" style="flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;">
            <div style="font-size: 54px; color: var(--accent-color); margin-bottom: 20px;"><i class="fas fa-robot"></i></div>
            <h2 style="margin-bottom: 10px; color: var(--text-main);">Üdvözöllek az Orion AI felületén!</h2>
            <p style="color: var(--text-muted);">Válassz egy beszélgetést, indíts újat, vagy kezdj el gépelni!</p>
        </div>`;
        currentChatId = null;
    }

    async function createNewChatFromBtn() {
        try {
            const res = await fetch('/api/chats', { method: 'POST' });
            const data = await res.json();
            currentChatId = data.id; currentChatTitle.innerText = "Új beszélgetés";
            // KÖZÉPRE HÚZVA A "Kezdj el gépelni" szöveg is!
            messagesContainer.innerHTML = '<div class="welcome-screen" style="flex: 1; display: flex; justify-content: center; align-items: center; color: var(--text-muted); font-size: 16px;"><i class="fas fa-magic" style="margin-right: 8px;"></i> Kezdj el gépelni!</div>';
            loadChats(); messageInput.focus();
        } catch (e) { console.error("Hiba:", e); }
    }
    if (newChatBtn) newChatBtn.addEventListener('click', createNewChatFromBtn);

    async function loadChats() {
        try {
            const res = await fetch('/api/chats'); const chats = await res.json(); chatList.innerHTML = '';
            chats.forEach(chat => {
                const div = document.createElement('div'); div.className = `chat-list-item ${chat.id === currentChatId ? 'active' : ''}`;
                const pinIcon = chat.pinned ? '<i class="fas fa-thumbtack" style="font-size:10px; margin-right:5px; color:var(--accent-color);"></i> ' : '';
                
                div.innerHTML = `
                    <span class="chat-title">${pinIcon}${chat.title}</span>
                    <div class="chat-actions">
                        <button class="rename-btn" title="Átnevezés" onclick="event.stopPropagation(); renameChat('${chat.id}', '${chat.title.replace(/'/g, "\\'")}')"><i class="fas fa-pen"></i></button>
                        <button class="pin-btn" title="${chat.pinned ? 'Levétel' : 'Kitűzés'}" onclick="event.stopPropagation(); togglePin('${chat.id}', ${!chat.pinned})"><i class="fas fa-thumbtack"></i></button>
                        <button class="delete-action" title="Törlés" onclick="event.stopPropagation(); deleteChat('${chat.id}')"><i class="fas fa-trash"></i></button>
                    </div>`;
                div.onclick = () => loadChatMessages(chat.id, chat.title);
                chatList.appendChild(div);
            });
        } catch (e) { console.error("Hiba a chatek betöltésekor:", e); }
    }

    window.renameChat = async (id, oldTitle) => {
        const newTitle = prompt("Új név:", oldTitle);
        if (newTitle && newTitle.trim() !== "" && newTitle !== oldTitle) {
            await fetch(`/api/chats/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: newTitle.trim() }) });
            if (currentChatId === id) currentChatTitle.innerText = newTitle.trim();
            loadChats();
        }
    };
    window.togglePin = async (id, pinnedStatus) => {
        await fetch(`/api/chats/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned: pinnedStatus }) });
        loadChats();
    };
    window.deleteChat = async (id) => {
        if (confirm("Biztosan törlöd ezt a beszélgetést?")) {
            await fetch(`/api/chats/${id}`, { method: 'DELETE' });
            if (currentChatId === id) showWelcomeScreen();
            loadChats();
        }
    };

    window.loadChatMessages = async (id, title) => {
        currentChatId = id; currentChatTitle.innerText = title;
        try {
            const res = await fetch(`/api/chats/${id}/messages`); const msgs = await res.json();
            messagesContainer.innerHTML = '';
            if (msgs.length === 0) {
                messagesContainer.innerHTML = '<div class="welcome-screen" style="flex: 1; display: flex; justify-content: center; align-items: center; color: var(--text-muted); font-size: 16px;"><i class="fas fa-magic" style="margin-right: 8px;"></i> Kezdj el gépelni!</div>';
            } else {
                msgs.forEach(m => appendMessage(m.role, m.content, m.id));
            }
            if (window.innerWidth <= 768) toggleMobileMenu(false);
            loadChats(); scrollToBottom();
        } catch (e) { console.error("Hiba:", e); }
    };

    if (fileUploadInput) {
        fileUploadInput.addEventListener('change', async function () {
            if (!this.files || this.files.length === 0) return;
            const file = this.files[0];
            filePreviewContainer.style.display = 'flex';
            filePreviewName.innerText = file.name;
            filePreviewLoading.style.display = 'inline-block';

            const formData = new FormData(); formData.append('file', file);
            try {
                const res = await fetch('/api/upload', { method: 'POST', body: formData });
                const data = await res.json();
                if (data.success) {
                    attachedFileData = data; filePreviewLoading.style.display = 'none';
                    filePreviewName.innerText = `${file.name} (Csatolva)`;
                } else { alert("Hiba: " + data.error); clearAttachment(); }
            } catch (err) { console.error(err); alert("Hálózati hiba."); clearAttachment(); }
            fileUploadInput.value = "";
        });
    }
    function clearAttachment() { attachedFileData = null; filePreviewContainer.style.display = 'none'; }
    if (removeFileBtn) removeFileBtn.addEventListener('click', clearAttachment);

    if (sendBtn) {
        sendBtn.addEventListener('click', async () => {
            if (sendBtn.classList.contains('stop-mode')) {
                if (abortController) abortController.abort(); resetSendButton();
                const typingMsg = document.querySelector('.message.assistant .fa-spin');
                if (typingMsg) typingMsg.parentElement.innerHTML = '<em>A generálás megszakítva.</em>';
                return;
            }
            const text = messageInput.value.trim();
            if (!text && !attachedFileData) return;
            if (!currentChatId) {
                const res = await fetch('/api/chats', { method: 'POST' });
                const data = await res.json();
                currentChatId = data.id; currentChatTitle.innerText = "Új beszélgetés"; messagesContainer.innerHTML = '';
            }

            let displayMsg = text;
            if (attachedFileData) {
                if (attachedFileData.type === 'image') displayMsg = `[Kép csatolva: ${attachedFileData.filename}]\n` + text;
                else displayMsg = `[Fájl csatolva: ${attachedFileData.filename}]\n` + text;
            }
            appendMessage('user', displayMsg, 'temp-id');
            messageInput.value = ''; messageInput.style.height = 'auto';

            const payloadFileData = attachedFileData; clearAttachment();
            const preferredLanguage = localStorage.getItem('orion_language') || 'hu';

            const typing = document.createElement('div'); typing.className = 'message-wrapper assistant-wrapper';
            typing.innerHTML = '<div class="message assistant"><i class="fas fa-circle-notch fa-spin"></i> Orion gondolkodik...</div>';
            messagesContainer.appendChild(typing); scrollToBottom();
            sendBtn.classList.add('stop-mode'); sendBtn.innerHTML = '<i class="fas fa-stop"></i>';
            abortController = new AbortController();

            try {
                const res = await fetch(`/api/chats/${currentChatId}/message`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: text, model: modelSelector.value, file: payloadFileData, language: preferredLanguage }),
                    signal: abortController.signal
                });
                const data = await res.json(); typing.remove();
                if (data.reply) appendMessage('assistant', data.reply, 'temp-id2');
                if (data.title_updated) currentChatTitle.innerText = data.new_title;
                loadChats();
            } catch (e) {
                if (e.name === 'AbortError') console.log("Megszakítva.");
                else {
                    typing.remove(); appendMessage('assistant', 'Hálózati hiba történt a generáláskor.', 'error-id');
                }
            } finally { resetSendButton(); scrollToBottom(); }
        });
    }

    function resetSendButton() { sendBtn.classList.remove('stop-mode'); sendBtn.innerHTML = '<i class="fas fa-arrow-up"></i>'; abortController = null; }
    if (messageInput) {
        messageInput.addEventListener('input', function () { this.style.height = 'auto'; this.style.height = (this.scrollHeight) + 'px'; });
        messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click(); } });
    }

    // --- ÜZENETEK HOZZÁADÁSA ---
    function appendMessage(role, content, msgId) {
        const welcome = messagesContainer.querySelector('.welcome-screen'); if (welcome) welcome.remove();
        
        // Hívjuk a formázó függvényünket
        let finalHtml = formatMessageContent(content);

        const wrapper = document.createElement('div'); wrapper.className = `message-wrapper ${role}-wrapper`;
        wrapper.innerHTML = `<div class="message ${role}">${finalHtml}</div>`;
        messagesContainer.appendChild(wrapper); scrollToBottom();
    }

    function scrollToBottom() { messagesContainer.scrollTop = messagesContainer.scrollHeight; }

    async function checkBroadcasts() {
        const currentUserName = document.body.getAttribute('data-user'); if (!currentUserName || currentUserName === 'admin') return;
        try {
            const res = await fetch('/api/broadcast'); const data = await res.json();
            if (data && data.id && data.text) {
                if (localStorage.getItem('seen_broadcast_id') !== data.id) {
                    const modal = document.getElementById('broadcast-modal'); const textCont = document.getElementById('broadcast-text-content');
                    if (modal && textCont) {
                        textCont.innerText = data.text; modal.style.display = 'flex';
                        document.getElementById('close-broadcast-btn').onclick = () => { modal.style.display = 'none'; localStorage.setItem('seen_broadcast_id', data.id); };
                    }
                }
            }
        } catch (e) { console.error("Hiba az üzenetszórás lekérésekor:", e); }
    }
    setInterval(checkBroadcasts, 4000); checkBroadcasts();
    showWelcomeScreen(); loadChats();
    
    function adaptModelSelector() {
        const modelSelector = document.getElementById('model-selector');
        const headerSlot = document.getElementById('header-model-slot');
        const footerSlot = document.getElementById('footer-model-slot');
        
        if (window.innerWidth <= 768) {
            if (modelSelector && headerSlot && !headerSlot.contains(modelSelector)) {
                headerSlot.appendChild(modelSelector);
            }
        } else {
            if (modelSelector && footerSlot && !footerSlot.contains(modelSelector)) {
                footerSlot.appendChild(modelSelector);
            }
        }
    }
    window.addEventListener('resize', adaptModelSelector);
    adaptModelSelector();
});