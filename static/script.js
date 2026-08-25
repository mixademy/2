document.addEventListener('DOMContentLoaded', () => {
    const chatList = document.getElementById('chat-list');
    const newChatBtn = document.getElementById('new-chat-btn');
    const messagesContainer = document.getElementById('messages-container');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const currentChatTitle = document.getElementById('current-chat-title');
    const modelSelector = document.getElementById('model-selector');

    let currentChatId = null;
    let abortController = null; // A generálás "megállításához" (fetch megszakítás)

    // --- MOBIL MENÜ LOGIKA ---
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
    
    document.addEventListener('click', (e) => { 
        if (sidebar.classList.contains('open') && !sidebar.contains(e.target)) toggleMobileMenu(false); 
    });

    // --- KEZDŐKÉPERNYŐ ---
    function showWelcomeScreen() {
        currentChatTitle.innerHTML = '<i class="fas fa-sparkles"></i> Orion AI';
        messagesContainer.innerHTML = `
            <div class="welcome-screen" style="text-align: center; margin: auto; padding: 40px; display: flex; flex-direction: column; justify-content: center; height: 100%;">
                <div style="font-size: 54px; color: var(--accent-color); margin-bottom: 20px; filter: drop-shadow(0 0 15px var(--accent-glow));">
                    <i class="fas fa-robot"></i>
                </div>
                <h2 style="margin-bottom: 10px; color: var(--text-main); font-weight: 600;">Üdvözöllek az Orion AI felületén!</h2>
                <p style="color: var(--text-muted); font-size: 15px; line-height: 1.5;">
                    Válassz egy beszélgetést a bal oldalon, indíts egyet a gombbal,<br>vagy csak kezdj el gépelni lent!
                </p>
            </div>
        `;
        currentChatId = null;
    }

    // --- ÚJ CHAT GOMBBAL ---
    async function createNewChatFromBtn() {
        const res = await fetch('/api/chats', { method: 'POST' });
        const data = await res.json();
        currentChatId = data.id; 
        currentChatTitle.innerText = "Új beszélgetés"; 
        messagesContainer.innerHTML = `
            <div class="welcome-screen" style="margin: auto; color: var(--text-muted);">
                <i class="fas fa-magic" style="margin-right: 8px;"></i> Kezdj el gépelni! Az Orion figyel.
            </div>
        `;
        loadChats();
        messageInput.focus();
    }
    newChatBtn.addEventListener('click', createNewChatFromBtn);

    // --- CHATEK LISTÁZÁSA (3 PÖTTY MENÜVEL) ---
    async function loadChats() {
        const res = await fetch('/api/chats'); 
        const chats = await res.json(); 
        chatList.innerHTML = '';
        chats.forEach(chat => {
            const div = document.createElement('div'); 
            div.className = `chat-list-item ${chat.id === currentChatId ? 'active' : ''}`;
            
            // Ha kitűzött, teszünk elé egy ikont
            const pinIcon = chat.pinned ? '<i class="fas fa-thumbtack" style="font-size:10px; margin-right:5px; color:var(--accent-color);"></i> ' : '';
            
            div.innerHTML = `
                <span class="chat-title">${pinIcon}${chat.title}</span>
                <div class="chat-actions">
                    <button class="dots-btn" onclick="event.stopPropagation(); toggleDropdown(this)">
                        <i class="fas fa-ellipsis-v"></i>
                    </button>
                    <div class="chat-dropdown">
                        <button class="rename-btn" onclick="event.stopPropagation(); renameChat('${chat.id}', '${chat.title}')">
                            <i class="fas fa-pen"></i> Átnevezés
                        </button>
                        <button class="pin-btn" onclick="event.stopPropagation(); togglePin('${chat.id}', ${!chat.pinned})">
                            <i class="fas fa-thumbtack"></i> ${chat.pinned ? 'Levétel' : 'Kitűzés'}
                        </button>
                        <button class="delete-action" onclick="event.stopPropagation(); deleteChat('${chat.id}')">
                            <i class="fas fa-trash"></i> Törlés
                        </button>
                    </div>
                </div>
            `;
            div.onclick = () => loadChatMessages(chat.id, chat.title); 
            chatList.appendChild(div);
        });
    }

    // --- CHAT MŰVELETEK (Átnevezés, Kitűzés, Törlés) ---
    window.renameChat = async (id, oldTitle) => {
        document.querySelectorAll('.chat-dropdown.show').forEach(m => m.classList.remove('show'));
        const newTitle = prompt("Add meg a beszélgetés új nevét:", oldTitle);
        if (newTitle && newTitle.trim() !== "" && newTitle !== oldTitle) {
            await fetch(`/api/chats/${id}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ title: newTitle.trim() })
            });
            if (currentChatId === id) currentChatTitle.innerText = newTitle.trim();
            loadChats();
        }
    };

    window.togglePin = async (id, pinnedStatus) => {
        document.querySelectorAll('.chat-dropdown.show').forEach(m => m.classList.remove('show'));
        await fetch(`/api/chats/${id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ pinned: pinnedStatus })
        });
        loadChats();
    };

    window.deleteChat = async (id) => {
        document.querySelectorAll('.chat-dropdown.show').forEach(m => m.classList.remove('show'));
        if(confirm("Biztosan törlöd ezt a beszélgetést?")) {
            await fetch(`/api/chats/${id}`, { method: 'DELETE' });
            if (currentChatId === id) { showWelcomeScreen(); }
            loadChats();
        }
    };

    // --- ELŐZMÉNYEK BETÖLTÉSE ---
    window.loadChatMessages = async (id, title) => {
        currentChatId = id; 
        currentChatTitle.innerText = title;
        const res = await fetch(`/api/chats/${id}/messages`); 
        const msgs = await res.json(); 
        messagesContainer.innerHTML = '';
        
        if (msgs.length === 0) {
            messagesContainer.innerHTML = '<div class="welcome-screen" style="margin: auto; color: var(--text-muted);"><i class="fas fa-magic" style="margin-right: 8px;"></i> Kezdj el gépelni! Az Orion figyel.</div>';
        } else {
            msgs.forEach(m => appendMessage(m.role, m.content, m.id));
        }
        
        if (window.innerWidth <= 768) toggleMobileMenu(false);
        loadChats();
        scrollToBottom();
    };

    // --- ÜZENET KÜLDÉS ÉS MEGÁLLÍTÁS LOGIKA ---
    sendBtn.addEventListener('click', async () => {
        // Ha épp generál, a gomb kattintásra megszakítja a folyamatot (Soft-Stop)
        if (sendBtn.classList.contains('stop-mode')) {
            if (abortController) abortController.abort(); // Megszakítja a hálózati kérést
            resetSendButton();
            const typingMsg = document.querySelector('.message.assistant .fa-spin');
            if(typingMsg) {
                typingMsg.parentElement.innerHTML = '<em>A generálás megszakítva.</em>';
            }
            return;
        }

        const text = messageInput.value.trim(); 
        if (!text) return;

        if (!currentChatId) {
            const res = await fetch('/api/chats', { method: 'POST' });
            const data = await res.json();
            currentChatId = data.id;
            currentChatTitle.innerText = "Új beszélgetés";
            messagesContainer.innerHTML = ''; 
        }

        appendMessage('user', text, 'temp-id'); 
        messageInput.value = '';
        messageInput.style.height = 'auto'; // Visszaállítja a textarea méretét
        
        const typing = document.createElement('div'); 
        typing.className = 'message-wrapper assistant-wrapper'; 
        typing.innerHTML = '<div class="message assistant"><i class="fas fa-circle-notch fa-spin"></i> Orion gondolkodik...</div>'; 
        messagesContainer.appendChild(typing);
        scrollToBottom();

        // Gomb átállítása stop módba
        sendBtn.classList.add('stop-mode');
        sendBtn.innerHTML = '<i class="fas fa-stop"></i>';
        
        abortController = new AbortController();

        try {
            const res = await fetch(`/api/chats/${currentChatId}/message`, { 
                method: 'POST', 
                headers: {'Content-Type':'application/json'}, 
                body: JSON.stringify({
                    message: text,
                    model: modelSelector.value // Küldjük a kiválasztott modellt!
                }),
                signal: abortController.signal
            });
            const data = await res.json(); 
            typing.remove();
            
            if (data.reply) appendMessage('assistant', data.reply, 'temp-id2');
            if (data.title_updated) { 
                currentChatTitle.innerText = data.new_title; 
            }
            loadChats(); 
        } catch (e) {
            if (e.name === 'AbortError') {
                console.log("Kérés megszakítva a felhasználó által.");
            } else {
                typing.remove();
                appendMessage('assistant', 'Hálózati hiba történt a generáláskor.', 'error-id');
            }
        } finally {
            resetSendButton();
            scrollToBottom();
        }
    });

    function resetSendButton() {
        sendBtn.classList.remove('stop-mode');
        sendBtn.innerHTML = '<i class="fas fa-arrow-up"></i>';
        abortController = null;
    }

    // Textarea auto-resize
    messageInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });

    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendBtn.click();
        }
    });

    // --- CSERÉLŐ ÉS MEGJELENÍTŐ MOTOR (SZERKESZTÉS GOMBBAL) ---
    function appendMessage(role, content, msgId) { 
        const welcome = messagesContainer.querySelector('.welcome-screen');
        if (welcome) welcome.remove();
        
        let safeHtml = content.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        
        // Képgeneráló animáció
        safeHtml = safeHtml.replace(
            /!\[([^\]]*)\]\s*\(?([^)\s<]+)\)?/g, 
            `<div class="img-wrapper">
                <div class="img-loading">
                    <i class="fas fa-circle-notch fa-spin"></i> Generálás folyamatban...
                </div>
                <img src="$2" alt="$1" class="chat-img" onload="this.style.display='block'; this.previousElementSibling.style.display='none'; this.parentElement.style.border='none'; this.parentElement.style.background='transparent';">
            </div>`
        );
        
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${role}-wrapper`;
        
        // Ha felhasználó, adunk hozzá egy szerkesztés gombot
        if (role === 'user' && msgId && msgId !== 'temp-id') {
            const rawContent = content.replace(/'/g, "\\'").replace(/"/g, "&quot;");
            wrapper.innerHTML = `
                <button class="edit-message-btn" title="Üzenet szerkesztése" onclick="editUserMessage('${msgId}', '${rawContent}')">
                    <i class="fas fa-pen"></i>
                </button>
                <div class="message ${role}" style="white-space:pre-wrap">${safeHtml}</div>
            `;
        } else {
            wrapper.innerHTML = `<div class="message ${role}" style="white-space:pre-wrap">${safeHtml}</div>`;
        }

        messagesContainer.appendChild(wrapper);
        scrollToBottom(); 
    }

    // --- ÜZENET SZERKESZTÉSE ---
    window.editUserMessage = async (msgId, oldContent) => {
        const newContent = prompt("Szerkeszd az üzenetet (a mentés után az AI újragenerálja a választ):", oldContent);
        if (newContent && newContent.trim() !== "" && newContent !== oldContent) {
            // Elküldjük a szerkesztett szöveget a backendnek
            await fetch(`/api/chats/${currentChatId}/messages`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ msg_id: msgId, content: newContent.trim() })
            });
            // Betöltjük újra a chatet (backend a módosítás utáni üzeneteket törölte)
            // A módosított üzenetet viszont egyből el is küldjük mintha új lenne, hogy a Groq reagáljon
            loadChatMessages(currentChatId, currentChatTitle.innerText).then(() => {
                messageInput.value = newContent.trim();
                // Opcionális: sendBtn.click(); ha azt akarod hogy azonnal el is küldje
            });
        }
    };

    function scrollToBottom() { messagesContainer.scrollTop = messagesContainer.scrollHeight; }

    // --- INSTANT MESSAGE (BROADCAST) ELLENŐRZŐ MOTOR ---
    async function checkBroadcasts() {
        const currentUserName = document.body.getAttribute('data-user');
        if (!currentUserName || currentUserName === 'admin') return;

        try {
            const res = await fetch('/api/broadcast');
            const data = await res.json();
            
            if (data && data.id && data.text) {
                const lastSeenId = localStorage.getItem('seen_broadcast_id');
                if (lastSeenId !== data.id) {
                    const modal = document.getElementById('broadcast-modal');
                    const textCont = document.getElementById('broadcast-text-content');
                    
                    if (modal && textCont) {
                        textCont.innerText = data.text;
                        modal.style.display = 'flex';
                        
                        const closeBtn = document.getElementById('close-broadcast-btn');
                        closeBtn.onclick = () => {
                            modal.style.display = 'none';
                            localStorage.setItem('seen_broadcast_id', data.id);
                        };
                    }
                }
            }
        } catch (e) {
            console.error("Hiba az üzenetszórás lekérésekor:", e);
        }
    }

    setInterval(checkBroadcasts, 4000);
    checkBroadcasts();
    
    showWelcomeScreen();
    loadChats();
});