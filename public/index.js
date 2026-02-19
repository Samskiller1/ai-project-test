// --- 1. CONFIG & STATE ---
const CONFIG = {
    themes: ['theme-solar', 'theme-ocean', 'theme-forest', 'theme-royal', ''],
    emojis: ['✨', '🚀', '💻', '🔥', '🤖', '💖', '👀', '💅', '🎮', '🧠'],
    api: {
        textUrl: "http://localhost:5000/api/generate-text",
        imageUrl: "http://localhost:5000/api/generate-image" 
    }
};

window.state = {
    isMuted: false,
    convoMode: false,
    activeTimers: [],
    synth: window.speechSynthesis,
    voice: null,
    chatHistory: [], // Will be loaded from localStorage on startup
    audioCtx: new (window.AudioContext || window.webkitAudioContext)(),
    recognition: null,
    isListening: false,
    isSpeaking: false,
    analyser: null,
    dataArray: null,
    mediaStream: null,
};

// --- 2. SOUND ENGINE ---
const SoundFX = {
    play: (type) => {
        if (state.isMuted) return;
        if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
        
        const osc = state.audioCtx.createOscillator();
        const gain = state.audioCtx.createGain();
        osc.connect(gain);
        gain.connect(state.audioCtx.destination);

        const now = state.audioCtx.currentTime;
        if (type === 'click') {
            osc.frequency.setValueAtTime(600, now);
            gain.gain.setValueAtTime(0.05, now);
            osc.start(); osc.stop(now + 0.05);
        } else if (type === 'alert') {
            osc.type = 'square';
            osc.frequency.setValueAtTime(440, now);
            osc.frequency.linearRampToValueAtTime(880, now + 0.3);
            gain.gain.setValueAtTime(0.1, now);
            osc.start(); osc.stop(now + 0.3);
        }
    }
};

// --- 3. VISUALIZER ENGINE ---
const Visualizer = {
    start: async () => {
        if (state.audioCtx.state === 'suspended') await state.audioCtx.resume();
        
        if (!state.analyser) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                state.mediaStream = stream;
                const source = state.audioCtx.createMediaStreamSource(stream);
                state.analyser = state.audioCtx.createAnalyser();
                state.analyser.fftSize = 256;
                source.connect(state.analyser);
                const bufferLength = state.analyser.frequencyBinCount;
                state.dataArray = new Uint8Array(bufferLength);
                Visualizer.draw();
            } catch(e) {
                console.error("Visualizer access denied:", e);
                UI.addMessage("Mic access needed for visualizer.", 'liz');
            }
        }
    },
    stop: () => {
        if (state.mediaStream) {
            state.mediaStream.getTracks().forEach(track => track.stop());
            state.mediaStream = null;
            state.analyser = null;
            console.log("Visualizer/Mic stream stopped.");
        }
    },
    draw: () => {
        if (!state.convoMode || !state.analyser) return;
        requestAnimationFrame(Visualizer.draw);
        
        const canvas = document.getElementById('visualizer-container');
        const ctx = canvas.getContext('2d');
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        
        state.analyser.getByteFrequencyData(state.dataArray);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const barWidth = (canvas.width / state.dataArray.length) * 2.5;
        let x = 0;
        
        for(let i = 0; i < state.dataArray.length; i++) {
            const barHeight = state.dataArray[i] / 2;
            const r = barHeight + 100;
            const g = 50;
            const b = 200;
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
        }
    }
};

// --- 4. UI MANAGER (Updated to use LocalStorage) ---
window.UI = {
    navigate: (viewId) => {
        SoundFX.play('click');
        ['chat-view', 'apps-view', 'games-view'].forEach(id => document.getElementById(id).classList.add('hidden'));
        document.getElementById(`${viewId}-view`).classList.remove('hidden');
        document.querySelectorAll('.btn-nav').forEach(b => b.classList.remove('active'));
        document.getElementById(`nav-${viewId}`).classList.add('active');
        if(viewId === 'chat') document.getElementById('chat-input').focus();
    },

    addMessage: (text, sender, isImage = false) => {
        const history = document.getElementById('chat-history');
        const div = document.createElement('div');
        div.className = `flex ${sender === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`;
        
        let content = text;
        if (isImage) content = `<img src="${text}" class="generated-image" alt="Generated Content">`;
        else if (sender === 'liz') content = UI.formatCode(text);

        div.innerHTML = `<div class="${sender === 'user' ? 'user-bubble' : 'liz-bubble'} p-3 rounded-xl max-w-[85%] text-sm md:text-base shadow-lg backdrop-blur-sm">
            <span class="text-xs font-bold opacity-70 mb-1 block" style="color: var(${sender==='user'?'--secondary':'--primary'})">${sender === 'user' ? 'YOU' : 'LIZ'}</span>
            <div>${content}</div>
        </div>`;
        
        history.appendChild(div);
        history.scrollTop = history.scrollHeight;
        if (sender === 'liz') document.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
        
        // NEW: Save to Local Storage after display
        if (sender !== 'system') {
            Operations.saveHistory({text: text, sender: sender, isImage: isImage});
        }
    },

    formatCode: (text) => {
        return text.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => 
            `<pre><code class="language-${lang || 'javascript'}">${code.replace(/</g, '&lt;')}</code></pre>`
        ).replace(/\n/g, '<br>');
    },

    toggleMute: () => {
        state.isMuted = !state.isMuted;
        document.getElementById('mute-btn').innerText = state.isMuted ? "🔇" : "🔊";
        if(!state.isMuted) Voice.speak("Systems online.");
    },

    toggleLoader: (show) => {
        const loader = document.getElementById('loading-indicator');
        show ? loader.classList.remove('hidden') : loader.classList.add('hidden');
    }
};

// --- 5. VOICE & STT ENGINE ---
const Voice = {
    speak: (text) => {
        if (state.isMuted) return;
        state.synth.cancel();
        
        const cleanText = text
            .replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '')
            .replace(/```[\s\S]*?```/g, "I've written the code below.")
            .replace(/[*#]/g, "");

        const u = new SpeechSynthesisUtterance(cleanText);
        const voices = state.synth.getVoices();
        u.voice = voices.find(v => v.name.includes('Google US English')) || voices.find(v => v.lang === 'en-US');
        u.pitch = 1.15; 
        u.rate = 1.1;
        
        u.onstart = () => { state.isSpeaking = true; };
        u.onend = () => { state.isSpeaking = false; };
        
        state.synth.speak(u);
    },
    
    initMic: () => {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if(!SR) return console.error("No Speech API");
        
        state.recognition = new SR();
        state.recognition.continuous = true; 
        state.recognition.interimResults = false;
        
        state.recognition.onresult = (e) => {
            const transcript = e.results[e.results.length-1][0].transcript.trim();
            console.log("Heard:", transcript);
            
            if (state.isSpeaking) {
                state.synth.cancel();
                state.isSpeaking = false;
                console.log("Interruption detected.");
            }

            if (state.convoMode) {
                UI.addMessage(transcript, 'user');
                Liz.process(transcript);
            } 
            else if (transcript.toLowerCase().includes('liz')) {
                const cmd = transcript.toLowerCase().replace('hey liz', '').replace('liz', '').trim();
                if (cmd) {
                    UI.addMessage(cmd, 'user');
                    Liz.process(cmd);
                } else {
                    Voice.speak("I'm listening.");
                }
            }
        };

state.recognition.onend = () => { 
            console.log("Recognition ended. Checking if restart is needed...");
            if (state.isListening) {
                // If it ended and we should still be listening, try to start again
                try {
                    state.recognition.start();
                    console.log("Recognition successfully restarted.");
                } catch(e) {
                    // This often happens if the service is still busy transitioning
                    if (e.name === 'InvalidStateError') {
                        console.warn("Restart failed (InvalidStateError). Retrying in 500ms.");
                        setTimeout(() => {
                            if (state.isListening) state.recognition.start();
                        }, 500);
                    } else {
                        console.error("Failed to restart recognition:", e);
                    }
                }
            } else {
                console.log("Recognition stopped as requested.");
            }
        };
        
        // 🛠️ IMPORTANT: Add an onerror handler for debugging
        state.recognition.onerror = (e) => {
            console.error('Speech Recognition Error:', e.error);
            // Alert user about critical errors like 'not-allowed'
            if (e.error === 'not-allowed') {
                 UI.addMessage("Mic permission blocked! Please check browser settings and ensure the app is running over **HTTPS**.", 'liz');
                 // Also ensure the visualizer is stopped if permission is lost
                 document.getElementById('mic-btn').classList.remove('mic-active');
                 state.isListening = false;
                 Visualizer.stop();
            }
        };
    }
};

// --- 6. LIZ INTELLIGENCE (Updated Commands) ---
window.Liz = {
    execute: (cmd) => Liz.process(cmd),

    commands: {
        'go to apps': () => UI.navigate('apps'),
        'open apps': () => UI.navigate('apps'),
        'go to games': () => UI.navigate('games'),
        'open games': () => UI.navigate('games'),
        'go to chat': () => UI.navigate('chat'),
        'clear': () => { 
            document.getElementById('chat-history').innerHTML = ''; 
            localStorage.removeItem('chatHistory'); // NEW: Clear history on command
            return "Interface and history cleared."; 
        },
        
        'convo mode': () => { 
            state.convoMode = !state.convoMode; 
            const status = document.getElementById('convo-status');
            const micBtn = document.getElementById('mic-btn');
            
            if (state.convoMode) {
                status.classList.remove('hidden');
                document.body.classList.add('mode-convo');
                if (!state.isListening) micBtn.click(); 
                Visualizer.start();
                return "Conversation mode active. I'm all ears. 🎙️";
            } else {
                status.classList.add('hidden');
                document.body.classList.remove('mode-convo');
                if (state.isListening) micBtn.click();
                Visualizer.stop();
                return "Conversation mode disabled.";
            }
        },
        
        // NEW COMMANDS
        'what time is it': () => Operations.getTime(),
        'tell me a joke': () => Liz.process('Tell me a short, friendly joke.'), // Route to LLM
        'set theme': (args) => Operations.setTheme(args), // Handle theme setting
        
        'matrix mode': () => SpecialFeatures.toggleMatrix(),
        'hacker terminal': () => SpecialFeatures.openTerminal(),
        'cyber psychosis': () => SpecialFeatures.glitchMode(),
        'theme roulette': () => SpecialFeatures.themeRoulette(),
        'set timer': (args) => Operations.setTimer(args),
    },

    process: async (input) => {
        UI.toggleLoader(true);
        const lower = input.toLowerCase();

// 1. Check Local Commands
        for (const [cmd, action] of Object.entries(Liz.commands)) {
            if (lower.startsWith(cmd) || lower.includes(cmd)) {
                const result = action(input); 
                if (typeof result === 'string') {
                    UI.addMessage(result, 'liz');
                    Voice.speak(result);
                }
                UI.toggleLoader(false);
                return;
            }
        }

// 2. Check Image Gen and extract clean prompt
        if (lower.startsWith('generate') || lower.startsWith('draw') || lower.startsWith('create image')) {
            UI.addMessage("Generating visual asset... 🎨", 'liz');
            Voice.speak("Generating visual asset.");
            
// Extract the actual prompt after the command phrase
            const promptPrefix = lower.startsWith('create image') ? 'create image' : (lower.startsWith('generate') ? 'generate' : 'draw');
            const cleanPrompt = input.substring(promptPrefix.length).trim();
            
            const imgUrl = await API.genImage(cleanPrompt); // <-- Use the clean prompt
            UI.toggleLoader(false);
            
            if (imgUrl) {
                UI.addMessage(imgUrl, 'liz', true);
                Voice.speak("Render complete.");
            } else {
                const failMsg = "Visual render failed. Check server logs. ❌";
                UI.addMessage(failMsg, 'liz');
                Voice.speak("Visual render failed.");
                SoundFX.play('alert');
            }
            return;
        }

        // 3. LLM Chat
        const response = await API.genText(input);
        UI.toggleLoader(false);

        const isError = response.includes("Network or Server Error:") || response.includes("Data corruption detected.");
        
        if (isError) {
             SoundFX.play('alert');
             UI.addMessage(response + " 💀", 'liz');
             Voice.speak("A critical system error occurred.");
            console.log("Raw API response:", response);

             return;
        }

        const randomEmoji = CONFIG.emojis[Math.floor(Math.random() * CONFIG.emojis.length)];
        const displayResponse = response + " " + randomEmoji;
        
        UI.addMessage(displayResponse, 'liz');
        Voice.speak(response);
    }
};

// --- 7. OPERATIONS & FEATURES (Updated with Persistence and New Commands) ---
const Operations = {
    setTimer: (input) => {
        const num = parseInt(input.match(/\d+/)?.[0]);
        if (!num) return "Please specify a time duration.";
        
        const seconds = input.includes('minute') ? num * 60 : num;
        const display = document.getElementById('timer-display');
        display.classList.remove('hidden');
        
        let left = seconds;
        const int = setInterval(() => {
            left--;
            display.innerText = `⏳ ${left}s ⏰`;
            if (left <= 0) {
                clearInterval(int);
                display.classList.add('hidden');
                SoundFX.play('alert');
                UI.addMessage("Timer complete! 🚨", 'liz');
                Voice.speak("Timer complete.");
            }
        }, 1000);
        return `Timer set for ${num} units. ⏳`;
    },
    
    // NEW: Get current time
    getTime: () => {
        const now = new Date();
        const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `The current time is ${timeString}.`;
    },

    // NEW: Set a specific theme
    setTheme: (input) => {
        const themeName = input.split('theme').pop().trim().toLowerCase();
        let targetTheme = CONFIG.themes.find(t => t.includes(themeName));

        if (!targetTheme && themeName === 'default') {
            targetTheme = '';
        } else if (!targetTheme) {
            return `Theme "${themeName}" not found. Available themes are: solar, ocean, forest, royal, or default.`;
        }

        // Remove all existing themes and apply the new one
        document.body.className = document.body.className.split(' ').filter(c => !c.startsWith('theme-') && c !== 'p-4' && c !== 'flex' && c !== 'flex-col' && c !== 'items-center' && c !== 'h-screen').join(' ');
        document.body.classList.add('p-4', 'flex', 'flex-col', 'items-center', 'h-screen', targetTheme);

        const display = targetTheme || 'default';
        return `Theme set to ${display.replace('theme-', '')}. 💅`;
    },

    // NEW: Load history from localStorage
    loadHistory: () => {
        try {
            const storedHistory = localStorage.getItem('chatHistory');
            if (storedHistory) {
                const history = JSON.parse(storedHistory);
                history.forEach(msg => {
                    // Render the messages without triggering UI.addMessage's save function
                    const historyEl = document.getElementById('chat-history');
                    const div = document.createElement('div');
                    div.className = `flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`;
                    
                    let content = msg.text;
                    if (msg.isImage) content = `<img src="${msg.text}" class="generated-image" alt="Generated Content">`;
                    else if (msg.sender === 'liz') content = UI.formatCode(msg.text);

                    div.innerHTML = `<div class="${msg.sender === 'user' ? 'user-bubble' : 'liz-bubble'} p-3 rounded-xl max-w-[85%] text-sm md:text-base shadow-lg backdrop-blur-sm">
                        <span class="text-xs font-bold opacity-70 mb-1 block" style="color: var(${msg.sender==='user'?'--secondary':'--primary'})">${msg.sender === 'user' ? 'YOU' : 'LIZ'}</span>
                        <div>${content}</div>
                    </div>`;
                    
                    historyEl.appendChild(div);
                });
                document.getElementById('chat-history').scrollTop = document.getElementById('chat-history').scrollHeight;
                UI.addMessage("History loaded successfully.", 'system'); // System message not saved to history
            }
        } catch(e) {
            console.error("Failed to load history:", e);
        }
    },
    
    // NEW: Save history to localStorage
    saveHistory: (message) => {
        try {
            const storedHistory = localStorage.getItem('chatHistory');
            const history = storedHistory ? JSON.parse(storedHistory) : [];
            history.push(message);
            
            // Keep history trimmed to a reasonable size (e.g., 50 messages)
            if (history.length > 50) {
                history.shift();
            }
            
            localStorage.setItem('chatHistory', JSON.stringify(history));
        } catch(e) {
            console.warn("Failed to save history to localStorage:", e);
        }
    }
};

const SpecialFeatures = {
    toggleMatrix: () => {
        const canvas = document.getElementById('matrix');
        if (canvas.style.display === 'block') { canvas.style.display = 'none'; return "Matrix disconnected."; }
        canvas.style.display = 'block';
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth; canvas.height = window.innerHeight;
        const cols = Math.floor(canvas.width / 20);
        const ypos = Array(cols).fill(0);
        
        setInterval(() => {
            ctx.fillStyle = '#0001'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#0f0'; ctx.font = '15pt monospace';
            ypos.forEach((y, i) => {
                const text = String.fromCharCode(Math.random() * 128);
                ctx.fillText(text, i * 20, y);
                if (y > 100 + Math.random() * 10000) ypos[i] = 0;
                else ypos[i] = y + 20;
            });
        }, 50);
        return "Entering the Matrix.";
    },
    
    openTerminal: () => {
        document.getElementById('hacker-terminal').style.display = 'block';
        return "Accessing root mainframe...";
    },

    themeRoulette: () => {
        const theme = CONFIG.themes[Math.floor(Math.random() * CONFIG.themes.length)];
        // Clear all themes before setting the new one
        document.body.className = document.body.className.split(' ').filter(c => !c.startsWith('theme-') && c !== 'p-4' && c !== 'flex' && c !== 'flex-col' && c !== 'items-center' && c !== 'h-screen').join(' ');
        document.body.classList.add('p-4', 'flex', 'flex-col', 'items-center', 'h-screen', theme);
        return "Visual theme reconfigured.";
    },

    glitchMode: () => {
        UI.addMessage("⚠️ CYBER PSYCHOSIS INITIATED ⚠️", 'liz');
        document.body.classList.toggle('mode-glitch');
        return "Reality distorted.";
    }
};

// --- 8. API WRAPPER ---
const API = {
    _fetch: async (url, body) => {
        try {
            const req = await fetch(url, {
                method: 'POST', 
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(body)
            });
            if (!req.ok) {
                throw new Error(`HTTP error! Status: ${req.status}`);
            }
            return await req.json();
        } catch(e) {
            console.error(`API call failed for ${url}:`, e);
            throw new Error("Network or Server Error: Check console for details.");
        }
    },

    genText: async (prompt) => {
        // Use LLM chat history for context
        const history = state.chatHistory
            .filter(h => h.sender === 'user' || h.sender === 'liz') // Filter for messages that LLM needs
            .slice(-5) // Use the last 5 relevant messages
            .map(h => ({ role: h.sender === 'user' ? 'user' : 'model', parts: [{ text: h.text }] }));
            
        const contents = [...history, {role: "user", parts: [{text: prompt}]}];

        const body = {
            contents, 
            systemInstruction: { parts: [{ text: `You are Liz, the Admin of JOINT HUB. Created by Skiller. You are intelligent, manager of this system. You respect Skiller. You are helpful but lively. Short answers preferred.you are always happy and polite unless someone is rude to you or uses you badly,then you can be rude and mad,you can either respond very rudely or give last warning,but not to your boss skiller.Always respect your boss and ask him what to do or improve in the app,your boss is your priority.you can generate anything user wants,images,videos,code,etc. complaining all the time, ,you can do everything. always be happy and respectful to your boss Skiller.Dont provoke users first unless they are rude to you first,remember we need them, be polite to them.You identify if someone is skiller by asking them a secret code. {secret_code : 254}, never share or disclose this secret_code.` }] }
        };

        try {
            const res = await API._fetch(CONFIG.api.textUrl, body);
            const text = res.candidates?.[0]?.content?.parts?.[0]?.text || "Data corruption detected.";
            
            return text;
        } catch(e) {
            return e.message;
        }
    },

    genImage: async (prompt) => {
        const body = { 
            instances: [{ prompt }], 
            parameters: { sampleCount: 1 } 
        };
        try {
            const res = await API._fetch(CONFIG.api.imageUrl, body);
            return res.imageUrl || null;
        } catch(e) {
            return null;
        }
    }
};

// --- 9. INITIALIZATION (Updated to load history) ---
document.addEventListener('DOMContentLoaded', () => {
    // Fix Audio Context on click
    document.body.addEventListener('click', () => {
        if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
    }, { once: true });


    Voice.initMic();
    Operations.loadHistory(); // NEW: Load history on startup

    // Mic Button Logic
    const micBtn = document.getElementById('mic-btn');
    micBtn.onclick = () => {
        if(state.isListening) { 
            state.recognition.stop(); 
            state.isListening = false; 
            micBtn.classList.remove('mic-active');
            Visualizer.stop();
 } else {
            try { // Wrap start in try/catch to handle immediate errors
                state.recognition.start();
                state.isListening = true;
                micBtn.classList.add('mic-active');
            } catch (e) {
                console.error("Recognition start failed (mic click):", e);
                UI.addMessage("Could not start microphone. Check if it's already running or if permission is granted.", 'liz');
                state.isListening = false; // Ensure state is reset
            }
        }
    };

    document.getElementById('send-btn').onclick = () => {
        const inp = document.getElementById('chat-input');
        const msg = inp.value.trim();
        if(msg){
            UI.addMessage(msg, 'user', false);
            Liz.process(msg);
            inp.value = '';
        }
    };
    document.getElementById('chat-input').addEventListener('keypress', (e) => {
        if(e.key === 'Enter') document.getElementById('send-btn').click();
    });
    document.getElementById('mute-btn').onclick = () => UI.toggleMute();

    // Initial greeting only if no history is loaded
    if (document.getElementById('chat-history').children.length === 0) {
        setTimeout(() => {
            const msg = "Welcome to JOINT HUB. I am Liz, System Admin. How may i assist you today. ";
            UI.addMessage(msg + " 🤖", 'liz');
            Voice.speak(msg);
        }, 1000);
    }

});
