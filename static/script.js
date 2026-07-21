document.addEventListener('DOMContentLoaded', () => {
    const chatList = document.getElementById('chat-list');
    const newChatBtn = document.getElementById('new-chat-btn');
    const messagesContainer = document.getElementById('messages-container');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const currentChatTitle = document.getElementById('current-chat-title');

    let currentChatId = null;

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

    // --- CHATEK LISTÁZÁSA ---
    async function loadChats() {
        const res = await fetch('/api/chats'); 
        const chats = await res.json(); 
        chatList.innerHTML = '';
        chats.forEach(chat => {
            const div = document.createElement('div'); 
            div.className = `chat-item ${chat.id === currentChatId ? 'active' : ''}`;
            div.innerHTML = `<span>${chat.title}</span><button class="delete-btn" onclick="event.stopPropagation(); deleteChat('${chat.id}')"><i class="fas fa-trash"></i></button>`;
            div.onclick = () => loadChatMessages(chat.id, chat.title); 
            chatList.appendChild(div);
        });
    }

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
            msgs.forEach(m => appendMessage(m.role, m.content));
        }
        
        if (window.innerWidth <= 768) toggleMobileMenu(false);
        loadChats();
        scrollToBottom();
    };

    // --- KÜLDÉS ÉS AUTOMATA CHAT INDÍTÁS ---
    sendBtn.addEventListener('click', async () => {
        const text = messageInput.value.trim(); 
        if (!text) return;

        if (!currentChatId) {
            const res = await fetch('/api/chats', { method: 'POST' });
            const data = await res.json();
            currentChatId = data.id;
            currentChatTitle.innerText = "Új beszélgetés";
            messagesContainer.innerHTML = ''; 
        }

        appendMessage('user', text); 
        messageInput.value = '';
        
        const typing = document.createElement('div'); 
        typing.className = 'message assistant'; 
        typing.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Orion gondolkodik...'; 
        messagesContainer.appendChild(typing);
        scrollToBottom();

        try {
            const res = await fetch(`/api/chats/${currentChatId}/message`, { 
                method: 'POST', 
                headers: {'Content-Type':'application/json'}, 
                body: JSON.stringify({message: text}) 
            });
            const data = await res.json(); 
            typing.remove();
            
            if (data.reply) appendMessage('assistant', data.reply);
            if (data.title_updated) { 
                currentChatTitle.innerText = data.new_title; 
            }
            loadChats(); 
        } catch (e) {
            typing.remove();
            appendMessage('assistant', 'Hálózati hiba történt a generáláskor.');
        }
        scrollToBottom();
    });

    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendBtn.click();
        }
    });

    // --- TÖRLÉS LOGIKA ---
    window.deleteChat = async (id) => {
        if(confirm("Biztosan törlöd ezt a beszélgetést?")) {
            await fetch(`/api/chats/${id}`, { method: 'DELETE' });
            if (currentChatId === id) { 
                showWelcomeScreen(); 
            }
            loadChats();
        }
    };

    // --- CSERÉLŐ ÉS MEGJELENÍTŐ MOTOR ---
    function appendMessage(role, content) { 
        const welcome = messagesContainer.querySelector('.welcome-screen');
        if (welcome) welcome.remove();
        
        let safeHtml = content.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        
        safeHtml = safeHtml.replace(
            /!\[([^\]]*)\]\s*\(?([^)\s<]+)\)?/g, 
            '<img src="$2" alt="$1" style="max-width: 100%; border-radius: 12px; margin-top: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); display: block;">'
        );
        
        messagesContainer.innerHTML += `<div class="message ${role}" style="white-space:pre-wrap">${safeHtml}</div>`; 
        scrollToBottom(); 
    }

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