document.addEventListener('DOMContentLoaded', () => {
    const chatList = document.getElementById('chat-list');
    const newChatBtn = document.getElementById('new-chat-btn');
    const messagesContainer = document.getElementById('messages-container');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const currentChatTitle = document.getElementById('current-chat-title');
    const modelSelector = document.getElementById('model-selector') || { value: 'smart' };

    // Fájlfeltöltés elemek
    const fileUploadInput = document.getElementById('file-upload');
    const filePreviewContainer = document.getElementById('file-preview-container');
    const filePreviewName = document.getElementById('file-preview-name');
    const removeFileBtn = document.getElementById('remove-file-btn');
    const filePreviewLoading = document.getElementById('file-preview-loading');

    let currentChatId = null;
    let abortController = null;
    let attachedFileData = null;

    // --- BEÁLLÍTÁSOK KEZELÉSE ---
    const settingsBtn = document.getElementById('open-settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const saveSettingsBtn = document.getElementById('save-settings-btn');
    const themeSelect = document.getElementById('theme-select');
    const languageSelect = document.getElementById('language-select');

    // Betöltjük a mentett beállításokat
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

    // --- MOBIL MENÜ ---
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const closeMenuBtn = document.getElementById('close-menu-btn');
    const sidebar = document.querySelector('.sidebar');
    const mobileOverlay = document.getElementById('mobile-overlay');

    function toggleMobileMenu(show) {
        sidebar.classList.toggle('open', show);
        mobileOverlay.classList.toggle('active', show);
    }
    if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMobileMenu(true); });
    if (closeMenuBtn) closeMenuBtn.addEventListener('click', () => toggleMobileMenu(false));
    if (mobileOverlay) mobileOverlay.addEventListener('click', () => toggleMobileMenu(false));
    document.addEventListener('click', (e) => { if (sidebar.classList.contains('open') && !sidebar.contains(e.target)) toggleMobileMenu(false); });

    // --- KEZDŐKÉPERNYŐ ÉS CHATEK ---
    function showWelcomeScreen() {
        currentChatTitle.innerHTML = '<i class="fas fa-sparkles"></i> Orion AI';
        messagesContainer.innerHTML = `<div class="welcome-screen" style="text-align: center; margin: auto; padding: 40px; display: flex; flex-direction: column; justify-content: center; height: 100%;">
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
            messagesContainer.innerHTML = '<div class="welcome-screen" style="margin: auto; color: var(--text-muted);"><i class="fas fa-magic"></i> Kezdj el gépelni!</div>';
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
                div.innerHTML = `<span class="chat-title">${pinIcon}${chat.title}</span>
                    <div class="chat-actions">
                        <button class="dots-btn" onclick="event.stopPropagation(); toggleDropdown(this)"><i class="fas fa-ellipsis-v"></i></button>
                        <div class="chat-dropdown">
                            <button class="rename-btn" onclick="event.stopPropagation(); renameChat('${chat.id}', '${chat.title.replace(/'/g, "\\'")}')"><i class="fas fa-pen"></i> Átnevezés</button>
                            <button class="pin-btn" onclick="event.stopPropagation(); togglePin('${chat.id}', ${!chat.pinned})"><i class="fas fa-thumbtack"></i> ${chat.pinned ? 'Levétel' : 'Kitűzés'}</button>
                            <button class="delete-action" onclick="event.stopPropagation(); deleteChat('${chat.id}')"><i class="fas fa-trash"></i> Törlés</button>
                        </div>
                    </div>`;
                div.onclick = () => loadChatMessages(chat.id, chat.title);
                chatList.appendChild(div);
            });
        } catch (e) { console.error("Hiba a chatek betöltésekor:", e); }
    }

    window.toggleDropdown = function (btn) {
        document.querySelectorAll('.chat-dropdown.show').forEach(m => { if (m !== btn.nextElementSibling) m.classList.remove('show'); });
        btn.nextElementSibling.classList.toggle('show');
    };
    window.renameChat = async (id, oldTitle) => {
        document.querySelectorAll('.chat-dropdown.show').forEach(m => m.classList.remove('show'));
        const newTitle = prompt("Új név:", oldTitle);
        if (newTitle && newTitle.trim() !== "" && newTitle !== oldTitle) {
            await fetch(`/api/chats/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: newTitle.trim() }) });
            if (currentChatId === id) currentChatTitle.innerText = newTitle.trim();
            loadChats();
        }
    };
    window.togglePin = async (id, pinnedStatus) => {
        document.querySelectorAll('.chat-dropdown.show').forEach(m => m.classList.remove('show'));
        await fetch(`/api/chats/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned: pinnedStatus }) });
        loadChats();
    };
    window.deleteChat = async (id) => {
        document.querySelectorAll('.chat-dropdown.show').forEach(m => m.classList.remove('show'));
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
            if (msgs.length === 0) messagesContainer.innerHTML = '<div class="welcome-screen" style="margin: auto; color: var(--text-muted);"><i class="fas fa-magic"></i> Kezdj el gépelni!</div>';
            else msgs.forEach(m => appendMessage(m.role, m.content, m.id));
            if (window.innerWidth <= 768) toggleMobileMenu(false);
            loadChats(); scrollToBottom();
        } catch (e) { console.error("Hiba:", e); }
    };

    // --- FÁJL FELTÖLTÉS LOGIKA ---
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

    // --- KÜLDÉS / MEGÁLLÍTÁS ---
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

    function appendMessage(role, content, msgId) {
        const welcome = messagesContainer.querySelector('.welcome-screen'); if (welcome) welcome.remove();
        let safeHtml = content.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        safeHtml = safeHtml.replace(/!\[([^\]]*)\]\s*\(?([^)\s<]+)\)?/g, `<div class="img-wrapper"><div class="img-loading"><i class="fas fa-circle-notch fa-spin"></i> Generálás...</div><img src="$2" alt="$1" class="chat-img" onload="this.style.display='block'; this.previousElementSibling.style.display='none'; this.parentElement.style.border='none'; this.parentElement.style.background='transparent';"></div>`);

        const wrapper = document.createElement('div'); wrapper.className = `message-wrapper ${role}-wrapper`;
        if (role === 'user' && msgId && msgId !== 'temp-id') {
            const rawContent = content.replace(/'/g, "\\'").replace(/"/g, "&quot;");
            wrapper.innerHTML = `<button class="edit-message-btn" onclick="editUserMessage('${msgId}', '${rawContent}')"><i class="fas fa-pen"></i></button><div class="message ${role}" style="white-space:pre-wrap">${safeHtml}</div>`;
        } else { wrapper.innerHTML = `<div class="message ${role}" style="white-space:pre-wrap">${safeHtml}</div>`; }
        messagesContainer.appendChild(wrapper); scrollToBottom();
    }

    window.editUserMessage = async (msgId, oldContent) => {
        const newContent = prompt("Szerkeszd az üzenetet:", oldContent);
        if (newContent && newContent.trim() !== "" && newContent !== oldContent) {
            await fetch(`/api/chats/${currentChatId}/messages`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msg_id: msgId, content: newContent.trim() }) });
            loadChatMessages(currentChatId, currentChatTitle.innerText).then(() => { messageInput.value = newContent.trim(); });
        }
    };

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
});