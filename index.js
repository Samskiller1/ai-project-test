
        // --- 1. CONFIG & STATE ---
        const CONFIG = {
            themes: ['theme-solar', 'theme-ocean', 'theme-forest', 'theme-royal', ''],
            emojis: ['✨', '🚀', '💻', '🔥', '🤖', '💖', '👀', '💅', '🎮', '🧠'],
            api: {
                textUrl: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent",
                imageUrl: "https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict",
                key: "AIzaSyC8oc4jqU4jJmuYX5F6_uPPre8KuKUZ3XQ", 
            }
        };

        window.state = {
            isMuted: false,
            convoMode: false,
            activeTimers: [],
            synth: window.speechSynthesis,
            voice: null,
            chatHistory: [],
            audioCtx: new (window.AudioContext || window.webkitAudioContext)(),
            recognition: null,
            isListening: false,
            isSpeaking: false, // New flag for interruption logic
            analyser: null,
            dataArray: null
        };

        // --- 2. SOUND ENGINE ---
        const SoundFX = {
            play: (type) => {
                if (state.isMuted) return;
                // Ensure AudioContext is running
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
            draw: () => {
                if (!state.convoMode) return;
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
                    // Dynamic color based on height
                    const r = barHeight + 100;
                    const g = 50;
                    const b = 200;
                    ctx.fillStyle = `rgb(${r},${g},${b})`;
                    ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
                    x += barWidth + 1;
                }
            }
        };

        // --- 4. UI MANAGER ---
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
                state.synth.cancel(); // Stop previous speech
                
                // CLEAN AUDIO: Remove emojis and markdown for speech
                const cleanText = text
                    .replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '')
                    .replace(/```[\s\S]*?```/g, "I've written the code below.")
                    .replace(/[*#]/g, "");

                const u = new SpeechSynthesisUtterance(cleanText);
                const voices = state.synth.getVoices();
                u.voice = voices.find(v => v.name.includes('Google US English')) || voices.find(v => v.lang === 'en-US');
                u.pitch = 1.15; 
                u.rate = 1.1;
                
                // Set speaking flag
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
                    
                    // INTERRUPTION LOGIC:
                    // If Liz is speaking and user talks, stop her immediately.
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
                    // Auto-restart if in Convo Mode or listening was active
                    if(state.isListening) state.recognition.start(); 
                };
            }
        };

        // --- 6. LIZ INTELLIGENCE ---
        window.Liz = {
            execute: (cmd) => Liz.process(cmd),

            commands: {
                'go to apps': () => UI.navigate('apps'),
                'open apps': () => UI.navigate('apps'),
                'go to games': () => UI.navigate('games'),
                'open games': () => UI.navigate('games'),
                'go to chat': () => UI.navigate('chat'),
                'clear': () => { document.getElementById('chat-history').innerHTML = ''; return "Interface cleaned."; },
                
                'convo mode': () => { 
                    state.convoMode = !state.convoMode; 
                    const status = document.getElementById('convo-status');
                    const micBtn = document.getElementById('mic-btn');
                    
                    if (state.convoMode) {
                        status.classList.remove('hidden');
                        document.body.classList.add('mode-convo');
                        // AUTO OPEN MIC & VISUALIZER
                        if (!state.isListening) micBtn.click(); 
                        Visualizer.start();
                        return "Conversation mode active. I'm all ears. 🎙️";
                    } else {
                        status.classList.add('hidden');
                        document.body.classList.remove('mode-convo');
                        if (state.isListening) micBtn.click();
                        return "Conversation mode disabled.";
                    }
                },
                
                'matrix mode': () => SpecialFeatures.toggleMatrix(),
                'hacker terminal': () => SpecialFeatures.openTerminal(),
                'cyber psychosis': () => SpecialFeatures.glitchMode(), // REPLACED ZEN MODE
                'theme roulette': () => SpecialFeatures.themeRoulette(),
                'set timer': (args) => Operations.setTimer(args),
            },

            process: async (input) => {
                UI.toggleLoader(true);
                const lower = input.toLowerCase();

                // 1. Check Local Commands
                for (const [cmd, action] of Object.entries(Liz.commands)) {
                    if (lower.includes(cmd)) {
                        const result = action(lower);
                        if (typeof result === 'string') {
                            UI.addMessage(result, 'liz');
                            Voice.speak(result);
                        }
                        UI.toggleLoader(false);
                        return;
                    }
                }

                // 2. Check Image Gen
                if (lower.startsWith('generate') || lower.startsWith('draw') || lower.startsWith('create image')) {
                    UI.addMessage("Generating visual asset... 🎨", 'liz');
                    Voice.speak("Generating visual asset...");
                    const img = await API.genImage(input);
                    UI.toggleLoader(false);
                    if (img) {
                        UI.addMessage(img, 'liz', true);
                        Voice.speak("Render complete.");
                    } else {
                        UI.addMessage("Visual render failed. ❌", 'liz');
                        Voice.speak("Visual render failed.");
                    }
                    return;
                }

                // 3. LLM Chat
                const response = await API.genText(input);
                UI.toggleLoader(false);
                
                // Add Lively Emoji (Only for text display)
                const randomEmoji = CONFIG.emojis[Math.floor(Math.random() * CONFIG.emojis.length)];
                const displayResponse = response + " " + randomEmoji;
                
                UI.addMessage(displayResponse, 'liz');
                Voice.speak(response); // Speak CLEAN text
            }
        };

        // --- 7. OPERATIONS & FEATURES ---
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
                    // EMOJI IN TIMER
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
                document.body.className = `p-4 flex flex-col items-center h-screen ${theme}`;
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
            genText: async (prompt) => {
                const history = state.chatHistory.slice(-5);
                const contents = [...history, {role: "user", parts: [{text: prompt}]}];
                
                try {
                    const req = await fetch(`${CONFIG.api.textUrl}?key=${CONFIG.api.key}`, {
                        method: 'POST', headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ 
                            contents, 
                            systemInstruction: { parts: [{ text: `You are Liz, the Admin of JOINT HUB. Created by Skiller. You are intelligent, manager of this system. You respect Skiller. You are helpful and lively. Short answers preferred.you are always happy and polite unless someone is rude to you or uses you badly,then you can be rude and mad,you can either respond very rudely or give last warning,but not to your boss skiller.Always respect your boss and ask him what to do or improve in the app,your boss is your priority.you can generate anything user wants,images,videos,code,etc. complaining all the time, ,you can do everything. always be happy and respectful to your boss Skiller.Dont provoke users first unless they are rude to you first,remember we need them, be polite to them `}] }
                        })
                    });
                    const res = await req.json();
                    const text = res.candidates?.[0]?.content?.parts?.[0]?.text || "Data corruption detected.";
                    state.chatHistory.push({role: "user", parts: [{text: prompt}]}, {role: "model", parts: [{text}]});
                    return text;
                } catch(e) { return "Network error."; }
            },
            genImage: async (prompt) => {
                try {
                    const req = await fetch(`${CONFIG.api.imageUrl}?key=${CONFIG.api.key}`, {
                        method: 'POST', headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1 } })
                    });
                    const res = await req.json();
                    return res.predictions?.[0]?.bytesBase64Encoded ? `data:image/png;base64,${res.predictions[0].bytesBase64Encoded}` : null;
                } catch(e) { return null; }
            }
        };

        // --- 9. INITIALIZATION ---
        document.addEventListener('DOMContentLoaded', () => {
            // Fix Audio Context on click
            document.body.addEventListener('click', () => {
                if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
            }, { once: true });

            window.speechSynthesis.onvoiceschanged = Voice.initVoices;
            Voice.initMic();

            // Mic Button Logic
            const micBtn = document.getElementById('mic-btn');
            micBtn.onclick = () => {
                if(state.isListening) { 
                    state.recognition.stop(); 
                    state.isListening = false; 
                    micBtn.classList.remove('mic-active');
                } else {
                    state.recognition.start();
                    state.isListening = true;
                    micBtn.classList.add('mic-active');
                }
            };

                    document.getElementById('send-btn').onclick = () => {
            const inp = document.getElementById('chat-input');
            const msg = inp.value.trim();
            if(msg){
                // FORCE USER MESSAGE TO DISPLAY
                if (window.UI && UI.addMessage) {
                UI.addMessage(msg, 'user', false);
                }
                if (window.Liz && Liz.process) {
                Liz.process(msg);
                }
                inp.value = '';
            }
            };
                        document.getElementById('chat-input').addEventListener('keypress', (e) => {
                if(e.key === 'Enter') document.getElementById('send-btn').click();
            });
            document.getElementById('mute-btn').onclick = () => UI.toggleMute();

            setTimeout(() => {
                const msg = "Welcome to JOINT HUB. I am Liz, your Admin. Systems operational.";
                UI.addMessage(msg + " 🤖", 'liz');
                Voice.speak(msg);
            }, 1000);
        });
