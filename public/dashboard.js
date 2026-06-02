document.addEventListener('DOMContentLoaded', () => {
    // 1. Authentication & Token Handlers
    let token = getAndStoreToken();
    if (!token) {
        redirectToLogin();
        return;
    }

    let activeGuildId = null;
    let activeGuildName = '';
    let currentIntervals = [];

    // Initialize UI
    initUser(token);
    initGuilds(token);
    setupEventListeners(token);

    // Get token from URL hash or localStorage
    function getAndStoreToken() {
        const hash = window.location.hash;
        if (hash) {
            const params = new URLSearchParams(hash.substring(1));
            const accessToken = params.get('access_token');
            if (accessToken) {
                localStorage.setItem('discord_token', accessToken);
                // Clean hash from URL without reloading
                window.history.replaceState(null, null, window.location.pathname);
                return accessToken;
            }
        }
        return localStorage.getItem('discord_token');
    }

    function redirectToLogin() {
        localStorage.removeItem('discord_token');
        window.location.href = '/index.html';
    }

    // 2. Load User Profile
    async function initUser(token) {
        try {
            const res = await fetch('https://discord.com/api/users/@me', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) {
                // Token might be expired
                redirectToLogin();
                return;
            }
            const user = await res.json();
            
            // Render user profile
            const userNameEl = document.getElementById('user-name');
            const userAvatarEl = document.getElementById('user-avatar');
            
            userNameEl.textContent = `${user.username}`;
            if (user.avatar) {
                userAvatarEl.src = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`;
            } else {
                // Default avatar
                const defaultAvatarIdx = user.discriminator ? parseInt(user.discriminator) % 5 : 0;
                userAvatarEl.src = `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIdx}.png`;
            }
        } catch (err) {
            console.error('Failed to load user info:', err);
            showToast('❌ Failed to verify user. Please log in again.', 'error');
        }
    }

    // 3. Load Guilds (Sidebar)
    async function initGuilds(token) {
        const serverListEl = document.getElementById('server-list');
        const loadingEl = document.getElementById('servers-loading');

        try {
            const res = await fetch('/api/guilds', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) {
                throw new Error('Failed to load servers');
            }
            const guilds = await res.json();
            
            if (loadingEl) loadingEl.remove();

            if (guilds.length === 0) {
                serverListEl.innerHTML += `
                    <div class="text-xs text-slate-500 text-center py-8 px-4">
                        No servers found where you are an Administrator and the bot is added.
                    </div>
                `;
                return;
            }

            guilds.forEach(guild => {
                const guildBtn = document.createElement('button');
                guildBtn.type = 'button';
                guildBtn.className = 'guild-item w-full flex items-center space-x-3 p-3 rounded-xl hover:bg-white/5 transition-all text-left cursor-pointer border border-transparent';
                guildBtn.dataset.id = guild.id;
                guildBtn.dataset.name = guild.name;

                // Guild Icon/Initials
                let iconHtml = '';
                if (guild.icon) {
                    iconHtml = `<img src="${guild.icon}" class="w-10 h-10 rounded-full object-cover shadow-md" alt="${guild.name}">`;
                } else {
                    const initials = guild.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
                    iconHtml = `
                        <div class="w-10 h-10 rounded-full bg-gradient-to-br from-[#c47c43]/40 to-[#fcba03]/40 border border-white/10 flex items-center justify-center text-sm font-bold text-white shadow-md">
                            ${initials}
                        </div>
                    `;
                }

                guildBtn.innerHTML = `
                    ${iconHtml}
                    <div class="flex-1 min-w-0">
                        <p class="font-semibold text-sm text-slate-200 truncate group-hover:text-white">${guild.name}</p>
                    </div>
                `;

                guildBtn.addEventListener('click', () => {
                    // Update active button state
                    document.querySelectorAll('.guild-item').forEach(b => {
                        b.classList.remove('bg-white/10', 'border-white/10', 'active');
                        b.classList.add('border-transparent');
                    });
                    guildBtn.classList.add('bg-white/10', 'border-white/10', 'active');
                    guildBtn.classList.remove('border-transparent');

                    selectServer(guild.id, guild.name);
                });

                serverListEl.appendChild(guildBtn);
            });
        } catch (err) {
            console.error('Failed to retrieve servers:', err);
            if (loadingEl) {
                loadingEl.textContent = 'Failed to load servers. Try refreshing.';
                loadingEl.className = 'text-center py-8 text-rose-500 text-sm';
            }
            showToast('❌ Failed to fetch your server list.', 'error');
        }
    }

    // 4. Select Server View Actions
    async function selectServer(guildId, guildName) {
        activeGuildId = guildId;
        activeGuildName = guildName;

        // UI transitions
        document.getElementById('empty-state').classList.add('hidden');
        const contentPanel = document.getElementById('dashboard-content');
        contentPanel.classList.remove('hidden');

        document.getElementById('active-guild-name').textContent = guildName;

        // Reset Settings Form
        currentIntervals = [];
        renderIntervalPills();

        // Load Settings and Statistics
        await loadSettings(guildId);
        await loadStats(guildId);
    }

    // 5. Load Settings for Selected Server
    async function loadSettings(guildId) {
        try {
            const res = await fetch(`/api/guilds/${guildId}/settings`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Settings fetch failed');

            const { settings, channels } = await res.json();

            // Populate channels select dropdown
            const channelSelect = document.getElementById('channel-select');
            channelSelect.innerHTML = '<option value="" disabled>Select a channel...</option>';
            
            channels.forEach(ch => {
                const opt = document.createElement('option');
                opt.value = ch.id;
                opt.textContent = `# ${ch.name}`;
                if (ch.id === settings.channelId) {
                    opt.selected = true;
                }
                channelSelect.appendChild(opt);
            });

            // If channel not in list or not selected
            if (!settings.channelId) {
                channelSelect.value = '';
            }

            // Set Mode Radios
            const modeRadios = document.getElementsByName('mode');
            modeRadios.forEach(radio => {
                radio.checked = (radio.value === settings.mode);
            });
            updateModeCardStates();

            // Set Feature Toggles
            document.getElementById('toggle-calendar').checked = settings.calendarEnabled;
            document.getElementById('toggle-threads').checked = settings.threadsEnabled;
            document.getElementById('toggle-delete').checked = settings.autoDeleteEnabled;

            // Load Intervals
            currentIntervals = settings.intervals || [];
            renderIntervalPills();

        } catch (err) {
            console.error('Error fetching settings:', err);
            showToast('❌ Failed to fetch server configurations.', 'error');
        }
    }

    // 6. Load Live Stats and Events
    async function loadStats(guildId) {
        try {
            const res = await fetch(`/api/guilds/${guildId}/stats`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Stats fetch failed');

            const data = await res.json();

            // Update stats widgets
            document.getElementById('stat-active-events').textContent = data.activeEventsCount;
            document.getElementById('stat-total-optins').textContent = data.totalOptIns;

            // Update upcoming list
            const eventsList = document.getElementById('upcoming-events-list');
            eventsList.innerHTML = '';

            if (!data.upcomingEvents || data.upcomingEvents.length === 0) {
                eventsList.innerHTML = '<p class="text-xs text-slate-500 py-6 text-center">No upcoming events scheduled.</p>';
                return;
            }

            data.upcomingEvents.forEach(event => {
                const eventItem = document.createElement('div');
                eventItem.className = 'py-3 flex flex-col md:flex-row md:items-center justify-between gap-2';
                
                const startTime = new Date(event.startTime);
                const timeString = startTime.toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit'
                });

                eventItem.innerHTML = `
                    <div class="min-w-0 flex-1">
                        <h4 class="font-bold text-sm text-slate-200 truncate" title="${event.name}">${event.name}</h4>
                        <p class="text-xs text-slate-400 mt-0.5">${timeString}</p>
                    </div>
                    <div class="flex items-center space-x-1.5 self-start md:self-center shrink-0">
                        <span class="text-xs font-semibold px-2 py-1 rounded bg-[#fcba03]/10 text-[#fcba03] border border-[#fcba03]/20">
                            👤 ${event.optInsCount} opt-in${event.optInsCount !== 1 ? 's' : ''}
                        </span>
                    </div>
                `;
                eventsList.appendChild(eventItem);
            });
        } catch (err) {
            console.error('Error fetching stats:', err);
            showToast('❌ Failed to fetch live server statistics.', 'error');
        }
    }

    // 7. Render Interval Pills
    function renderIntervalPills() {
        const container = document.getElementById('intervals-container');
        container.innerHTML = '';

        if (currentIntervals.length === 0) {
            container.innerHTML = '<span class="text-xs text-slate-500 py-1">No intervals configured. Please add one.</span>';
            return;
        }

        // Sort intervals by value converted to ms
        const sortedIntervals = [...currentIntervals].sort((a, b) => {
            const getMs = (item) => {
                const val = parseInt(item.value);
                if (item.unit === 'm') return val * 60;
                if (item.unit === 'h') return val * 3600;
                if (item.unit === 'd') return val * 86400;
                return 0;
            };
            return getMs(b) - getMs(a); // High to low
        });

        sortedIntervals.forEach((item, index) => {
            const pill = document.createElement('div');
            pill.className = 'interval-pill flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 transition-all text-xs font-bold text-slate-200';
            
            const unitLabel = item.unit === 'm' ? 'min' : item.unit === 'h' ? 'hour' : 'day';
            const plural = item.value !== 1 ? 's' : '';
            
            pill.innerHTML = `
                <span>${item.value} ${unitLabel}${plural} before</span>
                <button type="button" class="remove-pill-btn text-slate-400 hover:text-rose-400 transition-colors focus:outline-none" data-idx="${index}">&times;</button>
            `;

            // Delete action
            pill.querySelector('.remove-pill-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                currentIntervals = currentIntervals.filter((_, idx) => idx !== index);
                renderIntervalPills();
            });

            container.appendChild(pill);
        });
    }

    // Update the visual status of selected mode cards
    function updateModeCardStates() {
        const modeRadios = document.getElementsByName('mode');
        modeRadios.forEach(radio => {
            const card = radio.closest('.mode-card');
            if (radio.checked) {
                card.classList.add('border-[#fcba03]/40', 'bg-[#fcba03]/5', 'selected');
                card.classList.remove('border-white/10', 'bg-[#161c2d]/50');
            } else {
                card.classList.remove('border-[#fcba03]/40', 'bg-[#fcba03]/5', 'selected');
                card.classList.add('border-white/10', 'bg-[#161c2d]/50');
            }
        });
    }

    // 8. Event Listeners Wiring
    function setupEventListeners(token) {
        // Logout action
        document.getElementById('logout-btn').addEventListener('click', () => {
            redirectToLogin();
        });

        // Mode selector cards click delegation
        document.querySelectorAll('.mode-card').forEach(card => {
            card.addEventListener('click', () => {
                const radio = card.querySelector('input[type="radio"]');
                radio.checked = true;
                updateModeCardStates();
            });
        });

        // Interval Modal open
        const modal = document.getElementById('interval-modal');
        document.getElementById('add-interval-btn').addEventListener('click', () => {
            document.getElementById('new-interval-value').value = '';
            document.getElementById('new-interval-unit').value = 'h';
            
            modal.classList.remove('opacity-0', 'pointer-events-none');
            modal.classList.add('opacity-100');
            document.getElementById('new-interval-value').focus();
        });

        // Interval Modal close
        const closeModal = () => {
            modal.classList.add('opacity-0', 'pointer-events-none');
            modal.classList.remove('opacity-100');
        };
        document.getElementById('close-modal-btn').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });

        // Interval Modal confirm add
        document.getElementById('confirm-interval-btn').addEventListener('click', () => {
            const valInput = document.getElementById('new-interval-value');
            const unitSelect = document.getElementById('new-interval-unit');
            const val = parseInt(valInput.value, 10);
            const unit = unitSelect.value;

            if (isNaN(val) || val <= 0) {
                alert('Please enter a valid number greater than 0.');
                valInput.focus();
                return;
            }

            // Check duplicate
            const isDuplicate = currentIntervals.some(i => i.value === val && i.unit === unit);
            if (isDuplicate) {
                alert('This interval already exists.');
                return;
            }

            currentIntervals.push({ value: val, unit: unit });
            renderIntervalPills();
            closeModal();
        });

        // Settings Form Submit
        document.getElementById('settings-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!activeGuildId) return;

            const channelSelect = document.getElementById('channel-select');
            const channelId = channelSelect.value;
            const mode = document.querySelector('input[name="mode"]:checked')?.value;
            const calendarEnabled = document.getElementById('toggle-calendar').checked;
            const threadsEnabled = document.getElementById('toggle-threads').checked;
            const autoDeleteEnabled = document.getElementById('toggle-delete').checked;

            // Form validations
            if (!channelId) {
                showToast('⚠️ Please select an announcement channel.', 'error');
                channelSelect.focus();
                return;
            }

            if (!mode) {
                showToast('⚠️ Please select a reminder delivery mode.', 'error');
                return;
            }

            if (currentIntervals.length === 0) {
                showToast('⚠️ Please add at least one reminder interval.', 'error');
                return;
            }

            const payload = {
                channelId,
                mode,
                calendarEnabled,
                threadsEnabled,
                autoDeleteEnabled,
                intervals: currentIntervals
            };

            const saveBtn = document.getElementById('save-btn');
            const originalBtnText = saveBtn.textContent;
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving Settings...';
            saveBtn.style.opacity = '0.7';

            try {
                const res = await fetch(`/api/guilds/${activeGuildId}/settings`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(payload)
                });

                if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.error || 'Failed to save settings');
                }

                showToast('✅ Configurations saved and scheduled successfully!', 'success');
                
                // Refresh statistics just in case
                await loadStats(activeGuildId);
            } catch (err) {
                console.error('Error saving settings:', err);
                showToast(`❌ Error: ${err.message}`, 'error');
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = originalBtnText;
                saveBtn.style.opacity = '1';
            }
        });
    }

    // 9. Toast Notification Handler
    let toastTimeout = null;
    function showToast(message, type = 'success') {
        const toast = document.getElementById('toast-banner');
        const iconEl = document.getElementById('toast-icon');
        const msgEl = document.getElementById('toast-message');

        iconEl.textContent = type === 'success' ? '✅' : '⚠️';
        msgEl.textContent = message;

        // Clear existing timeout
        if (toastTimeout) {
            clearTimeout(toastTimeout);
        }

        // Show toast
        toast.classList.remove('translate-y-12', 'opacity-0', 'pointer-events-none');
        toast.classList.add('translate-y-0', 'opacity-100');

        // Hide toast after 4 seconds
        toastTimeout = setTimeout(() => {
            toast.classList.add('translate-y-12', 'opacity-0', 'pointer-events-none');
            toast.classList.remove('translate-y-0', 'opacity-100');
        }, 4000);
    }
});
