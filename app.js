/**
 * Anomaly Detector Dashboard
 * Step 1: Layout, Sample Data & Responsive Visuals
 */

// Global State & Sample Data
const state = {
  // Step 5: Firebase Auth & Cloud Firestore State
  currentUser: null,
  alertEmail: '',
  isOnline: navigator.onLine,
  pendingAlerts: [], // In-memory queue for offline alerts

  // Step 6: EmailJS Alert Configuration & Rate Limiting State
  emailAlertsEnabled: localStorage.getItem('emailAlertsEnabled') !== null ? (localStorage.getItem('emailAlertsEnabled') === 'true') : true, // Default ON
  emailFilterChoice: localStorage.getItem('emailFilterChoice') || 'danger_only', // 'danger_only' or 'all'
  emailTypeCooldownMap: {}, // Type -> last sent timestamp (60s cooldown per alert type)
  emailHourlyTimestamps: [], // Timestamps of sent emails in the past hour (max 10)
  emailLimitReached: false,

  theme: localStorage.getItem('theme') || 'light',
  sensorAlertSound: localStorage.getItem('sensorAlertSound') || 'device', // 'device', 'laptop', 'both', 'silent'
  alarmOutput: localStorage.getItem('alarmOutput') || 'device', // 'device', 'laptop', 'both'
  personAlertSound: localStorage.getItem('personAlertSound') || 'none', // 'none' (Alert only), 'device', 'laptop'
  pirBuzzer: localStorage.getItem('pirBuzzer') !== null ? (localStorage.getItem('pirBuzzer') === 'true') : true, // Default ON
  geminiApiKey: localStorage.getItem('geminiApiKey') || '',
  geminiModelOverride: localStorage.getItem('geminiModelOverride') || '',
  geminiResolvedModel: localStorage.getItem('geminiLastWorkingModel') || '',
  geminiAvailableModelsList: [],
  geminiPausedUntil: 0, // Timestamp until which Gemini calls are paused (e.g. 30s pause on all failures)
  alerts: [],
  stats: {
    alertsToday: 0,
    motionEvents: 0,
    objectsDetected: 0,
    soundAlerts: 0
  },
  serialConnected: false,
  cameraActive: false,
  micActive: false,
  micStopping: false, // Guard flag: set immediately when user presses "Stop mic"
  micStartTime: 0, // Timestamp when mic was started (to suppress alerts for first 2 seconds)
  micSensitivity: localStorage.getItem('micSensitivity') || 'medium', // 'low', 'medium', 'high'
  lastAudioDangerAlertTime: 0,
  lastAudioCautionAlertTime: 0,
  soundAlertCooldownMap: {}, // Cooldown per sound class: { className: timestamp }
  currentDbLevel: null,
  backgroundDbLevel: null, // Null indicates no baseline has been established yet
  // Live hardware state
  currentPir: 0,
  previousPir: 0,
  currentDist: 72,
  lastAlertTime: 0,
  lastPirMotionAlertTime: 0,
  lastCloseObjectAlertTime: 0,
  lastDangerMotionDistAlertTime: 0,
  lastPirMotionTime: 0, // Timestamp when PIR motion was last active (PIR === 1)
  lastCloseDistTime: 0, // Timestamp when DIST was under threshold
  consecutiveCloseDistReadings: 0, // Debounce count (requires 2 in a row)
  isCloseObjectStateActive: false, // Hysteresis state: true when active, resets when DIST > threshold + 10
  closeObjectAlertEnabled: localStorage.getItem('closeObjectAlertEnabled') !== null ? (localStorage.getItem('closeObjectAlertEnabled') === 'true') : true, // Default ON
  closeObjectDistance: parseInt(localStorage.getItem('closeObjectDistance') || '50', 10), // Default 50 cm
  // Camera & AI state
  lastPersonAlertTime: 0,
  detectedObjects: [],
  // Harmful object & Continuous Danger Alarm
  isContinuousAlarmActive: false,
  continuousAlarmInterval: null,
  continuousAudioLoopCtx: null,
  continuousAudioOsc: null,
  continuousAudioGain: null,
  lastHarmfulObjectSeenTime: 0,
  // Sensor Alert Sound Cooldown (at most one beep every 3 seconds)
  lastSensorBeepTime: 0,
  // Self-Noise & Feedback Suppression (BUG 2)
  lastAlarmSoundEndTime: 0, // Timestamp when any alarm sound (BUZZ or laptop beep/siren) ends
  lastBuzzSentTime: 0, // Timestamp when the last BUZZ was sent to ESP32
  // Layer 2 Vision AI State
  lastVisionAiCheckTime: 0,
  isVisionAiRunning: false,
  recentFramesHistory: [] // Sliding window of last 5 detection frames for temporal smoothing
};

// Serial connection & debug state objects
let serialPort = null;
let serialReader = null;
let serialWriter = null;
let serialEncoder = null;
let keepReading = false;
let serialBuffer = '';
let isSerialLoopRunning = false;
let serialLineCount = 0;
const serialRecentLines = []; // Last 10 raw lines received
let serialLastReceiveTime = 0;
let serialWatchdogTimer = null;

// Camera & YOLO11 ONNX Runtime Web objects
let cameraStream = null;
let yoloSession = null;
let yoloProvider = 'wasm'; // 'webgpu' or 'wasm'
let isModelLoading = false;
let detectionIntervalId = null;
let isDetecting = false;

// COCO 80 Class Names for YOLO11
const COCO_CLASSES = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat', 'traffic light',
  'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow',
  'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
  'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard',
  'tennis racket', 'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
  'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
  'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote', 'keyboard', 'cell phone',
  'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear',
  'hair drier', 'toothbrush'
];

// References to Charts
let chartAlertsByType = null;
let chartDeviceStatus = null;
let chartActivityOverTime = null;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide icons
  if (window.lucide) {
    lucide.createIcons();
  }

  // Apply Theme
  applyTheme(state.theme);

  // Apply Saved Sensor Alert Sound Setting
  applySensorAlertSoundUI(state.sensorAlertSound);

  // Apply Saved Alarm Output Setting
  applyAlarmOutputUI(state.alarmOutput);

  // Apply Saved Person Alert Sound Setting
  applyPersonAlertSoundUI(state.personAlertSound);

  // Apply Saved PIR Buzzer Toggle Setting
  applyPirBuzzerUI(state.pirBuzzer);

  // Apply Saved Close Object Alert & Distance Settings
  applyCloseObjectSettingsUI();

  // Apply Saved Mic Sensitivity Setting
  applyMicSensitivityUI(state.micSensitivity);

  // Initialize Charts
  initCharts();

  // Render Initial Alerts Table (Empty until loaded from Firestore)
  renderAlertsTable(state.alerts);

  // Initialize Idle Audio Wave Animation
  initAudioVisualizerIdle();

  // If Gemini API Key exists, query available models on startup
  if (state.geminiApiKey) {
    discoverGeminiModels(state.geminiApiKey);
  } else {
    updateDebugGeminiDisplay('No API key set', []);
  }

  // Initialize EmailJS & Email Alerts UI (Step 6)
  initEmailJs();
  applyEmailSettingsUI();
  updateDebugEmailAlertsStatus();

  // Initialize Firebase Auth & Connectivity Listeners
  initFirebaseAuthAndSync();
});

/* ========================================================
   FIREBASE AUTHENTICATION & CLOUD FIRESTORE (STEP 5)
======================================================== */
let authMode = 'login'; // 'login' or 'signup'

function initFirebaseAuthAndSync() {
  // Listen for online / offline events
  window.addEventListener('online', () => {
    state.isOnline = true;
    hideOfflineIndicator();
    flushPendingAlerts();
  });

  window.addEventListener('offline', () => {
    state.isOnline = false;
    showOfflineIndicator();
  });

  if (!navigator.onLine) {
    state.isOnline = false;
    showOfflineIndicator();
  }

  // Setup Firebase Auth observer when Firebase is available
  if (window.fb && window.fb.auth) {
    setupAuthObserver();
  } else {
    // Wait for custom event from firebase.js module
    window.addEventListener('firebase-ready', () => {
      setupAuthObserver();
    }, { once: true });
  }
}

function setupAuthObserver() {
  if (!window.fb || !window.fb.onAuthStateChanged) return;
  window.fb.onAuthStateChanged(async (user) => {
    if (user) {
      state.currentUser = user;
      updateUserProfileUI(user);
      showDashboardView();
      // Load settings (e.g. alert email) and saved alerts from Firestore
      await loadProfileSettings(user.uid);
      await loadAlertsFromFirestore(user.uid);
    } else {
      state.currentUser = null;
      showAuthScreen();
    }
  });
}

function switchAuthTab(mode) {
  authMode = mode;
  const tabLogin = document.getElementById('tabLoginBtn');
  const tabSignup = document.getElementById('tabSignupBtn');
  const submitBtnText = document.getElementById('authSubmitBtnText');
  const forgotBtn = document.getElementById('forgotPasswordBtn');
  const errorBox = document.getElementById('authErrorMsg');
  const successBox = document.getElementById('authSuccessMsg');

  if (errorBox) errorBox.classList.add('hidden');
  if (successBox) successBox.classList.add('hidden');

  if (mode === 'login') {
    if (tabLogin) {
      tabLogin.className = 'flex-1 py-2 text-xs font-bold rounded-lg transition bg-emerald-500 text-slate-950';
    }
    if (tabSignup) {
      tabSignup.className = 'flex-1 py-2 text-xs font-bold rounded-lg transition text-slate-400 hover:text-white';
    }
    if (submitBtnText) submitBtnText.textContent = 'Log In to Dashboard';
    if (forgotBtn) forgotBtn.classList.remove('hidden');
  } else {
    if (tabSignup) {
      tabSignup.className = 'flex-1 py-2 text-xs font-bold rounded-lg transition bg-emerald-500 text-slate-950';
    }
    if (tabLogin) {
      tabLogin.className = 'flex-1 py-2 text-xs font-bold rounded-lg transition text-slate-400 hover:text-white';
    }
    if (submitBtnText) submitBtnText.textContent = 'Create Account & Sign In';
    if (forgotBtn) forgotBtn.classList.add('hidden');
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const emailInput = document.getElementById('authEmail');
  const passInput = document.getElementById('authPassword');
  const email = (emailInput?.value || '').trim();
  const pass = passInput?.value || '';

  const errorBox = document.getElementById('authErrorMsg');
  const errorText = document.getElementById('authErrorText');
  const successBox = document.getElementById('authSuccessMsg');
  const submitBtn = document.getElementById('authSubmitBtn');

  if (errorBox) errorBox.classList.add('hidden');
  if (successBox) successBox.classList.add('hidden');

  if (!email || !pass) {
    showAuthError('Please fill in both email and password.');
    return;
  }

  if (!window.fb) {
    showAuthError('Firebase SDK is loading. Please check your internet connection.');
    return;
  }

  if (submitBtn) submitBtn.disabled = true;

  try {
    if (authMode === 'signup') {
      await window.fb.createUser(email, pass);
    } else {
      await window.fb.signIn(email, pass);
    }
  } catch (err) {
    console.error('Firebase Auth error:', err);
    let msg = 'Authentication failed. Please check your credentials.';
    const code = err.code || '';
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      msg = 'Wrong password or invalid credentials. Please try again.';
    } else if (code === 'auth/user-not-found') {
      msg = 'No account found with this email. Click "Sign Up" above to create one.';
    } else if (code === 'auth/email-already-in-use') {
      msg = 'This email is already registered. Please log in instead.';
    } else if (code === 'auth/weak-password') {
      msg = 'Weak password: Password must be at least 6 characters.';
    } else if (code === 'auth/invalid-email') {
      msg = 'Please enter a valid email address.';
    } else if (code === 'auth/network-request-failed') {
      msg = 'Network connection failed. Please check your internet connection.';
    } else if (err.message) {
      msg = err.message;
    }
    showAuthError(msg);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function handleForgotPassword() {
  const emailInput = document.getElementById('authEmail');
  const email = (emailInput?.value || '').trim();
  if (!email) {
    showAuthError('Please enter your email address in the field above first, then click Forgot password.');
    return;
  }

  if (!window.fb) {
    showAuthError('Firebase is still loading. Please check your internet connection.');
    return;
  }

  try {
    await window.fb.resetPassword(email);
    const successBox = document.getElementById('authSuccessMsg');
    const successText = document.getElementById('authSuccessText');
    const errorBox = document.getElementById('authErrorMsg');
    if (errorBox) errorBox.classList.add('hidden');
    if (successText) successText.textContent = `Password reset email sent to ${email}. Check your inbox.`;
    if (successBox) successBox.classList.remove('hidden');
  } catch (err) {
    console.error('Password reset error:', err);
    let msg = 'Failed to send password reset email.';
    if (err.code === 'auth/user-not-found') {
      msg = 'No user account found with this email.';
    } else if (err.code === 'auth/invalid-email') {
      msg = 'Invalid email address.';
    } else if (err.message) {
      msg = err.message;
    }
    showAuthError(msg);
  }
}

async function handleLogout() {
  if (!confirm('Are you sure you want to log out of the surveillance dashboard?')) return;
  try {
    if (window.fb) {
      await window.fb.signOut();
    }
    state.currentUser = null;
    showAuthScreen();
  } catch (err) {
    console.error('Logout error:', err);
  }
}

function showAuthError(msg) {
  const errorBox = document.getElementById('authErrorMsg');
  const errorText = document.getElementById('authErrorText');
  if (errorText) errorText.textContent = msg;
  if (errorBox) errorBox.classList.remove('hidden');
}

function showAuthScreen() {
  const authScreen = document.getElementById('authScreen');
  const dashboardContainer = document.getElementById('dashboardAppContainer');
  if (authScreen) authScreen.classList.remove('hidden');
  if (dashboardContainer) dashboardContainer.classList.add('hidden');
  if (window.lucide) lucide.createIcons();
}

function showDashboardView() {
  const authScreen = document.getElementById('authScreen');
  const dashboardContainer = document.getElementById('dashboardAppContainer');
  if (authScreen) authScreen.classList.add('hidden');
  if (dashboardContainer) dashboardContainer.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function updateUserProfileUI(user) {
  const email = user.email || 'Owner';
  const namePart = email.split('@')[0];
  const capitalized = namePart.charAt(0).toUpperCase() + namePart.slice(1);
  const firstLetter = email.charAt(0).toUpperCase();

  const avatarBox = document.getElementById('userAvatarLetter');
  const ownerProfileName = document.getElementById('ownerProfileName');
  const userEmailDisplay = document.getElementById('userEmailDisplay');
  const greetingName = document.getElementById('ownerGreetingName');

  if (avatarBox) avatarBox.textContent = firstLetter;
  if (ownerProfileName) ownerProfileName.textContent = capitalized;
  if (userEmailDisplay) userEmailDisplay.textContent = email;
  if (greetingName) greetingName.textContent = capitalized;
}

function showOfflineIndicator() {
  const banner = document.getElementById('offlineIndicator');
  if (banner) banner.classList.remove('hidden');
}

function hideOfflineIndicator() {
  const banner = document.getElementById('offlineIndicator');
  if (banner) banner.classList.add('hidden');
}

/* ========================================================
   EMAILJS EMAIL ALERTS (STEP 6)
======================================================== */
const EMAILJS_CONFIG = {
  serviceId: "service_1pmxz1y",
  templateId: "template_4a67f43",
  publicKey: "Yjz1UIlfuaOMxo6tM"
};

/**
 * Initialize EmailJS with public key
 */
function initEmailJs() {
  try {
    if (window.emailjs && window.emailjs.init) {
      window.emailjs.init({
        publicKey: EMAILJS_CONFIG.publicKey
      });
      console.log('EmailJS SDK initialized successfully with public key');
    } else {
      console.warn('EmailJS SDK not yet loaded from CDN');
    }
  } catch (err) {
    console.error('Failed to initialize EmailJS SDK:', err);
  }
}

/**
 * Toggle Email alerts switch (ON/OFF)
 */
function toggleEmailAlerts(enabled) {
  state.emailAlertsEnabled = enabled;
  localStorage.setItem('emailAlertsEnabled', enabled ? 'true' : 'false');
  applyEmailSettingsUI();
  updateDebugEmailAlertsStatus();
}

/**
 * Set choice: 'danger_only' or 'all'
 */
function setEmailFilterChoice(choice) {
  state.emailFilterChoice = choice;
  localStorage.setItem('emailFilterChoice', choice);
  applyEmailSettingsUI();
}

/**
 * Update the Email Settings modal UI elements
 */
function applyEmailSettingsUI() {
  const toggle = document.getElementById('emailAlertsToggle');
  const label = document.getElementById('emailAlertsToggleLabel');
  const optDangerOnly = document.getElementById('optEmailDangerOnly');
  const optDangerCaution = document.getElementById('optEmailDangerCaution');
  const emailInput = document.getElementById('alertEmailInput');

  if (toggle) toggle.checked = state.emailAlertsEnabled;
  if (label) label.textContent = `Email alerts: ${state.emailAlertsEnabled ? 'ON' : 'OFF'}`;

  const isDangerOnly = state.emailFilterChoice === 'danger_only';
  if (optDangerOnly) {
    optDangerOnly.className = isDangerOnly 
      ? 'py-2 px-3 rounded-lg text-xs font-bold text-center transition flex items-center justify-center gap-1.5 bg-rose-500 text-white shadow-sm'
      : 'py-2 px-3 rounded-lg text-xs font-semibold text-center transition flex items-center justify-center gap-1.5 text-slate-400 hover:text-white';
  }
  if (optDangerCaution) {
    optDangerCaution.className = !isDangerOnly 
      ? 'py-2 px-3 rounded-lg text-xs font-bold text-center transition flex items-center justify-center gap-1.5 bg-emerald-500 text-slate-950 shadow-sm'
      : 'py-2 px-3 rounded-lg text-xs font-semibold text-center transition flex items-center justify-center gap-1.5 text-slate-400 hover:text-white';
  }

  if (emailInput) {
    emailInput.value = state.alertEmail || (state.currentUser?.email || '');
  }

  if (window.lucide) lucide.createIcons();
}

/**
 * Update debug panel status line
 */
function updateDebugEmailAlertsStatus(overrideText = null) {
  const statusEl = document.getElementById('debugEmailAlertsStatus');
  if (!statusEl) return;

  if (overrideText) {
    statusEl.textContent = overrideText;
    statusEl.className = overrideText.includes('limit') ? 'text-rose-400 font-bold animate-pulse' : 'text-amber-400 font-semibold';
    return;
  }

  if (!state.emailAlertsEnabled) {
    statusEl.textContent = 'Disabled (OFF)';
    statusEl.className = 'text-slate-500 font-semibold';
  } else if (state.emailLimitReached) {
    statusEl.textContent = 'Email limit reached';
    statusEl.className = 'text-rose-400 font-bold animate-pulse';
  } else {
    const filterText = state.emailFilterChoice === 'danger_only' ? 'Danger only' : 'All alerts';
    statusEl.textContent = `Active (${filterText})`;
    statusEl.className = 'text-emerald-400 font-semibold';
  }
}

/**
 * Save email settings to Firestore users/{uid}/settings/profile
 */
async function saveEmailSettingsToCloud() {
  const emailInput = document.getElementById('alertEmailInput');
  const email = (emailInput?.value || '').trim();
  const statusElem = document.getElementById('alertEmailSaveStatus');
  const btn = document.getElementById('saveEmailSettingsBtn');

  if (!email) {
    alert('Please enter a valid alert email address.');
    return;
  }

  state.alertEmail = email;

  if (!state.currentUser || !window.fb || !window.fb.db) {
    alert('You must be signed in to save settings to the cloud.');
    return;
  }

  if (btn) btn.disabled = true;
  try {
    const profileRef = window.fb.doc(window.fb.db, `users/${state.currentUser.uid}/settings/profile`);
    await window.fb.setDoc(profileRef, {
      alertEmail: email,
      emailAlertsEnabled: state.emailAlertsEnabled,
      emailFilterChoice: state.emailFilterChoice,
      updatedAt: window.fb.serverTimestamp()
    }, { merge: true });

    if (statusElem) {
      statusElem.classList.remove('hidden');
      setTimeout(() => statusElem.classList.add('hidden'), 3500);
    }
  } catch (err) {
    console.error('Failed to save email settings to Firestore:', err);
    alert('Failed to save settings: ' + (err.message || 'Network error'));
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Keep backward-compatible alias for existing caller
async function saveAlertEmailSetting() {
  await saveEmailSettingsToCloud();
}

/**
 * Check rate limits before sending an email:
 * 1. At most one email per alert type every 60 seconds
 * 2. At most 10 emails per hour in total
 */
function checkEmailRateLimits(alertType) {
  const now = Date.now();

  // 1. Clean up hourly timestamps older than 60 minutes
  const oneHourAgo = now - 60 * 60 * 1000;
  state.emailHourlyTimestamps = state.emailHourlyTimestamps.filter(t => t > oneHourAgo);

  // 2. Check total hourly limit (max 10 emails / hour)
  if (state.emailHourlyTimestamps.length >= 10) {
    state.emailLimitReached = true;
    updateDebugEmailAlertsStatus('Email limit reached');
    console.warn(`Email hourly limit (10/hr) reached. Current count: ${state.emailHourlyTimestamps.length}`);
    return { allowed: false, reason: 'limit_hourly' };
  }

  // 3. Check 60-second cooldown per alert type
  const lastSentForType = state.emailTypeCooldownMap[alertType] || 0;
  if (now - lastSentForType < 60 * 1000) {
    const remainingSec = Math.ceil((60 * 1000 - (now - lastSentForType)) / 1000);
    console.log(`Email skipped: type "${alertType}" is in 60s cooldown (${remainingSec}s remaining)`);
    return { allowed: false, reason: 'cooldown_type' };
  }

  // Allowed
  state.emailLimitReached = false;
  return { allowed: true };
}

/**
 * Low-level EmailJS sender function
 * Template parameters: to_email, severity, type, source, details, time
 * Never includes the Gemini API key or credentials.
 */
async function sendAlertEmailJs(templateParams) {
  if (!window.emailjs || !window.emailjs.send) {
    throw new Error('EmailJS SDK is not loaded. Check internet connection.');
  }

  // Security check: ensure Gemini API key or credentials are never leaked
  for (const key of Object.keys(templateParams)) {
    if (typeof templateParams[key] === 'string' && state.geminiApiKey && templateParams[key].includes(state.geminiApiKey)) {
      templateParams[key] = templateParams[key].replace(state.geminiApiKey, '[REDACTED]');
    }
  }

  const response = await window.emailjs.send(
    EMAILJS_CONFIG.serviceId,
    EMAILJS_CONFIG.templateId,
    templateParams,
    EMAILJS_CONFIG.publicKey
  );

  return response;
}

/**
 * Dispatches an automated email alert for a triggered anomaly
 * Does not block buzzer or UI alerts if it fails.
 */
async function dispatchAlertEmail(alertRecord) {
  // 1. Check if email alerts are enabled
  if (!state.emailAlertsEnabled) {
    return;
  }

  // 2. Check filter: 'danger_only' vs 'all'
  const isDanger = (alertRecord.severity === 'Danger');
  if (state.emailFilterChoice === 'danger_only' && !isDanger) {
    console.log(`Email alert skipped for ${alertRecord.type}: filter set to Danger only.`);
    return;
  }

  // 3. Determine recipient email address
  const recipientEmail = (state.alertEmail || (state.currentUser?.email || '')).trim();
  if (!recipientEmail) {
    console.warn('No alert email address configured. Skipping email alert.');
    return;
  }

  // 4. Check rate limits (60s per type, 10/hr total)
  const rateLimitCheck = checkEmailRateLimits(alertRecord.type);
  if (!rateLimitCheck.allowed) {
    return;
  }

  // 5. Prepare template parameters
  const templateParams = {
    to_email: recipientEmail,
    severity: alertRecord.severity || 'Caution',
    type: alertRecord.type || 'Security Anomaly',
    source: alertRecord.source || 'Surveillance System',
    details: alertRecord.details || alertRecord.type,
    time: alertRecord.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  };

  try {
    const res = await sendAlertEmailJs(templateParams);
    console.log('Alert email sent successfully via EmailJS:', res);

    // Record rate limit timestamps
    const now = Date.now();
    state.emailTypeCooldownMap[alertRecord.type] = now;
    state.emailHourlyTimestamps.push(now);

    // Update alert row in memory with "Emailed" badge
    alertRecord.emailStatus = 'sent';
    renderAlertsTable(state.alerts);
    updateDebugEmailAlertsStatus();
  } catch (err) {
    console.error('Failed to send alert email via EmailJS:', err);
    // Mark alert as email failed without blocking anything
    alertRecord.emailStatus = 'failed';
    alertRecord.emailError = err.text || err.message || 'Delivery error';
    renderAlertsTable(state.alerts);
  }
}

/**
 * Handle "Send test email" button in Settings
 */
async function handleSendTestEmail() {
  const btn = document.getElementById('sendTestEmailBtn');
  const statusBox = document.getElementById('testEmailStatusBox');
  const emailInput = document.getElementById('alertEmailInput');

  const targetEmail = (emailInput?.value || state.alertEmail || state.currentUser?.email || '').trim();
  if (!targetEmail) {
    alert('Please enter a recipient email address in the Alert email field first.');
    return;
  }

  if (statusBox) {
    statusBox.className = 'text-[11px] font-mono rounded-lg px-2.5 py-1.5 bg-slate-800 text-slate-300 block';
    statusBox.textContent = 'Sending test email via EmailJS...';
  }
  if (btn) btn.disabled = true;

  const testParams = {
    to_email: targetEmail,
    severity: 'Danger',
    type: 'Test Alert (EmailJS Verification)',
    source: 'Settings Test',
    details: 'This is a test notification confirming your email alert setup is functioning properly.',
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  };

  try {
    await sendAlertEmailJs(testParams);
    if (statusBox) {
      statusBox.className = 'text-[11px] font-mono rounded-lg px-2.5 py-1.5 bg-emerald-950/80 border border-emerald-800 text-emerald-300 block flex items-center gap-1.5';
      statusBox.innerHTML = '<i data-lucide="check-circle" class="w-3.5 h-3.5 text-emerald-400"></i><span>Email sent successfully!</span>';
      if (window.lucide) lucide.createIcons();
    }
  } catch (err) {
    console.error('Test email failed:', err);
    const errText = err.text || err.message || JSON.stringify(err);
    if (statusBox) {
      statusBox.className = 'text-[11px] font-mono rounded-lg px-2.5 py-1.5 bg-rose-950/80 border border-rose-800 text-rose-300 block';
      statusBox.textContent = `Error: ${errText}`;
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ========================================================
   FIRESTORE PROFILE SETTINGS (STEP 5 REQUIREMENT 8 & STEP 6)
======================================================== */
async function loadProfileSettings(uid) {
  if (!window.fb || !window.fb.db) return;
  try {
    const profileRef = window.fb.doc(window.fb.db, `users/${uid}/settings/profile`);
    const snap = await window.fb.getDoc(profileRef);
    if (snap.exists()) {
      const data = snap.data();
      if (data.alertEmail) {
        state.alertEmail = data.alertEmail;
      }
      if (data.emailAlertsEnabled !== undefined) {
        state.emailAlertsEnabled = Boolean(data.emailAlertsEnabled);
        localStorage.setItem('emailAlertsEnabled', state.emailAlertsEnabled ? 'true' : 'false');
      }
      if (data.emailFilterChoice) {
        state.emailFilterChoice = data.emailFilterChoice;
        localStorage.setItem('emailFilterChoice', state.emailFilterChoice);
      }
      applyEmailSettingsUI();
      updateDebugEmailAlertsStatus();
    }
  } catch (err) {
    console.warn('Could not load profile settings from Firestore:', err);
  }
}

/* ========================================================
   FIRESTORE ALERTS SAVE & LOAD (STEP 5 REQUIREMENTS 3, 4, 6)
======================================================== */
/**
 * Saves an alert to Firestore at users/{uid}/alerts
 * Schema: time (server timestamp), type, severity, source, details, distance, aiChecked
 */
async function saveAlertToFirestore(alertRecord) {
  // If not logged in or offline, queue in memory
  if (!state.currentUser || !window.fb || !window.fb.db || !navigator.onLine) {
    state.pendingAlerts.push(alertRecord);
    showOfflineIndicator();
    return;
  }

  try {
    const alertsCol = window.fb.collection(window.fb.db, `users/${state.currentUser.uid}/alerts`);
    const docData = {
      time: window.fb.serverTimestamp(),
      type: alertRecord.type,
      severity: alertRecord.severity, // 'Caution' or 'Danger'
      source: alertRecord.source,     // 'PIR' or 'Camera' or 'Microphone'
      details: alertRecord.details || alertRecord.type,
      distance: alertRecord.distance !== undefined ? alertRecord.distance : 'N/A',
      aiChecked: Boolean(alertRecord.aiChecked)
    };

    await window.fb.addDoc(alertsCol, docData);
  } catch (err) {
    console.warn('Failed saving alert to Firestore, queuing offline:', err);
    state.pendingAlerts.push(alertRecord);
    showOfflineIndicator();
  }

  // Step 6: Dispatch automated email alert (non-blocking)
  try {
    dispatchAlertEmail(alertRecord);
  } catch (emailErr) {
    console.error('Non-blocking error in dispatchAlertEmail:', emailErr);
  }
}

/**
 * Flush any queued alerts saved while offline
 */
async function flushPendingAlerts() {
  if (!state.currentUser || !window.fb || !window.fb.db || !state.pendingAlerts.length) {
    hideOfflineIndicator();
    return;
  }

  console.log(`Flushing ${state.pendingAlerts.length} offline alerts to Firestore...`);
  const queue = [...state.pendingAlerts];
  state.pendingAlerts = [];

  for (const item of queue) {
    try {
      const alertsCol = window.fb.collection(window.fb.db, `users/${state.currentUser.uid}/alerts`);
      await window.fb.addDoc(alertsCol, {
        time: window.fb.serverTimestamp(),
        type: item.type,
        severity: item.severity,
        source: item.source,
        details: item.details || item.type,
        distance: item.distance !== undefined ? item.distance : 'N/A',
        aiChecked: Boolean(item.aiChecked)
      });
    } catch (e) {
      console.error('Failed to flush queued alert:', e);
      state.pendingAlerts.push(item);
      showOfflineIndicator();
      return;
    }
  }

  hideOfflineIndicator();
}

/**
 * Loads latest 200 alerts from users/{uid}/alerts on login
 * Rebuilds state.alerts, stats, counters, donut chart, and activity chart
 */
async function loadAlertsFromFirestore(uid) {
  if (!window.fb || !window.fb.db) return;
  try {
    const alertsCol = window.fb.collection(window.fb.db, `users/${uid}/alerts`);
    const q = window.fb.query(
      alertsCol,
      window.fb.orderBy('time', 'desc'),
      window.fb.limit(200)
    );

    const snapshot = await window.fb.getDocs(q);
    const loadedAlerts = [];

    snapshot.forEach(docSnap => {
      const d = docSnap.data();
      let formattedTime = 'Just now';
      let timestamp = Date.now();

      if (d.time && d.time.toDate) {
        const dateObj = d.time.toDate();
        timestamp = dateObj.getTime();
        formattedTime = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }

      loadedAlerts.push({
        id: docSnap.id,
        firestoreId: docSnap.id,
        time: formattedTime,
        severity: d.severity || 'Caution',
        type: d.type || 'Anomaly Alert',
        source: d.source || 'PIR',
        distance: d.distance || 'N/A',
        status: (d.severity === 'Danger') ? 'Critical' : 'Warning',
        aiCheck: d.aiChecked ? 'confirmed' : 'none',
        aiChecked: Boolean(d.aiChecked),
        details: d.details || '',
        ts: timestamp
      });
    });

    state.alerts = loadedAlerts;

    // Rebuild counters, stats, donut chart, and activity chart
    rebuildStatsAndChartsFromAlerts(loadedAlerts);

    // Render Recent alerts table
    renderAlertsTable(state.alerts);
  } catch (err) {
    console.error('Error loading alerts from Firestore:', err);
    // If permission or offline error, ensure empty or previous table renders
    renderAlertsTable(state.alerts);
  }
}

/**
 * Rebuild stats counters and charts from loaded alerts
 */
function rebuildStatsAndChartsFromAlerts(alertsList) {
  let motionCount = 0;
  let objectsCount = 0;
  let soundCount = 0;

  // Hourly buckets for the past 24 hours (Activity chart)
  const now = Date.now();
  const bucket0 = 0;
  let bucketMotion = [0, 0, 0, 0, 0, 0, 0];
  let bucketDistance = [0, 0, 0, 0, 0, 0, 0];

  alertsList.forEach(a => {
    const typeUpper = (a.type || '').toUpperCase();
    const sourceUpper = (a.source || '').toUpperCase();

    if (sourceUpper.includes('PIR') || typeUpper.includes('MOTION')) {
      motionCount++;
    }
    if (sourceUpper.includes('CAMERA') || sourceUpper.includes('ULTRASONIC') || typeUpper.includes('PERSON') || typeUpper.includes('HARMFUL') || typeUpper.includes('CLOSE OBJECT')) {
      objectsCount++;
    }
    if (sourceUpper.includes('MICROPHONE') || sourceUpper.includes('MIC') || typeUpper.includes('SOUND')) {
      soundCount++;
    }

    // Classify into activity time intervals (24h span)
    const ageHours = (now - (a.ts || now)) / (1000 * 60 * 60);
    let slot = 6; // 'Now'
    if (ageHours > 20) slot = 0;
    else if (ageHours > 16) slot = 1;
    else if (ageHours > 12) slot = 2;
    else if (ageHours > 8) slot = 3;
    else if (ageHours > 4) slot = 4;
    else if (ageHours > 1) slot = 5;

    if (sourceUpper.includes('PIR') || typeUpper.includes('MOTION')) {
      bucketMotion[slot]++;
    }
    if (a.distance && a.distance !== 'N/A' && a.distance !== 'No Echo') {
      bucketDistance[slot]++;
    }
  });

  state.stats.alertsToday = alertsList.length;
  state.stats.motionEvents = motionCount;
  state.stats.objectsDetected = objectsCount;
  state.stats.soundAlerts = soundCount;

  updateStatsDisplay();

  // Update Donut Chart & legend
  if (chartAlertsByType) {
    chartAlertsByType.data.datasets[0].data = [motionCount, objectsCount, soundCount];
    chartAlertsByType.update();
  }
  const donutTotal = document.getElementById('donutTotalCount');
  const donutMotion = document.getElementById('donutCountMotion');
  const donutPerson = document.getElementById('donutCountPerson');
  const donutSound = document.getElementById('donutCountSound');
  if (donutTotal) donutTotal.textContent = alertsList.length;
  if (donutMotion) donutMotion.textContent = motionCount;
  if (donutPerson) donutPerson.textContent = objectsCount;
  if (donutSound) donutSound.textContent = soundCount;

  // Update Activity Line Chart
  if (chartActivityOverTime) {
    chartActivityOverTime.data.datasets[0].data = bucketMotion;
    chartActivityOverTime.data.datasets[1].data = bucketDistance;
    chartActivityOverTime.update();
  }
}

/**
 * Clear Alert History (Requirement 5)
 * Deletes all documents in users/{uid}/alerts after confirmation
 */
async function handleClearAlertHistory() {
  if (!confirm('Are you sure you want to delete ALL alert history? This cannot be undone.')) {
    return;
  }

  if (!state.currentUser || !window.fb || !window.fb.db) {
    state.alerts = [];
    rebuildStatsAndChartsFromAlerts([]);
    renderAlertsTable([]);
    return;
  }

  const btn = document.getElementById('clearHistoryBtn');
  if (btn) btn.disabled = true;

  try {
    const alertsCol = window.fb.collection(window.fb.db, `users/${state.currentUser.uid}/alerts`);
    const snap = await window.fb.getDocs(alertsCol);

    const batch = window.fb.writeBatch(window.fb.db);
    snap.forEach(docSnap => {
      batch.delete(docSnap.ref);
    });
    await batch.commit();

    state.alerts = [];
    rebuildStatsAndChartsFromAlerts([]);
    renderAlertsTable([]);
  } catch (err) {
    console.error('Failed to clear alert history from Firestore:', err);
    alert('Failed to clear alert history: ' + (err.message || 'Error'));
  } finally {
    if (btn) btn.disabled = false;
  }
}


/* ========================================================
   THEME (DARK / LIGHT MODE)
======================================================== */
function toggleDarkMode() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', state.theme);
  applyTheme(state.theme);
}

function applyTheme(theme) {
  const html = document.documentElement;
  const themeIcon = document.getElementById('themeIcon');
  if (theme === 'dark') {
    html.classList.add('dark');
    if (themeIcon) {
      themeIcon.setAttribute('data-lucide', 'sun');
    }
  } else {
    html.classList.remove('dark');
    if (themeIcon) {
      themeIcon.setAttribute('data-lucide', 'moon');
    }
  }
  if (window.lucide) lucide.createIcons();
  
  // Re-render charts with correct theme colors
  if (chartActivityOverTime) {
    const isDark = theme === 'dark';
    const gridColor = isDark ? '#334155' : '#f1f5f9';
    const textColor = isDark ? '#94a3b8' : '#64748b';
    chartActivityOverTime.options.scales.x.grid.color = gridColor;
    chartActivityOverTime.options.scales.x.ticks.color = textColor;
    chartActivityOverTime.options.scales.y.grid.color = gridColor;
    chartActivityOverTime.options.scales.y.ticks.color = textColor;
    chartActivityOverTime.update();
  }
}

/* ========================================================
   CHART.JS INITIALIZATION (Matching Screenshot)
======================================================== */
function initCharts() {
  const isDark = state.theme === 'dark';

  // 1. Donut Chart: Alerts by Type
  const ctxType = document.getElementById('chartAlertsByType').getContext('2d');
  chartAlertsByType = new Chart(ctxType, {
    type: 'doughnut',
    data: {
      labels: ['Motion + Close Object', 'Person Detected', 'Glass Break / Sound'],
      datasets: [{
        data: [14, 7, 3],
        backgroundColor: [
          '#10b981', // Emerald green
          '#8b5cf6', // Violet purple
          '#f59e0b'  // Amber orange
        ],
        borderWidth: 3,
        borderColor: isDark ? '#1e293b' : '#ffffff',
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f172a',
          titleFont: { family: 'Plus Jakarta Sans', size: 12 },
          bodyFont: { family: 'Plus Jakarta Sans', size: 11 },
          padding: 10,
          cornerRadius: 8
        }
      }
    }
  });

  // 2. Donut Chart: Device Status
  const ctxStatus = document.getElementById('chartDeviceStatus').getContext('2d');
  chartDeviceStatus = new Chart(ctxStatus, {
    type: 'doughnut',
    data: {
      labels: ['Sensors Online', 'Sensors Offline'],
      datasets: [{
        data: [4, 0],
        backgroundColor: [
          '#10b981', // Emerald
          '#e2e8f0'  // Slate light
        ],
        borderWidth: 3,
        borderColor: isDark ? '#1e293b' : '#ffffff',
        hoverOffset: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f172a',
          padding: 10,
          cornerRadius: 8
        }
      }
    }
  });

  // 3. Line Chart: Activity Over Time (Past 24 Hours)
  const ctxActivity = document.getElementById('chartActivityOverTime').getContext('2d');
  chartActivityOverTime = new Chart(ctxActivity, {
    type: 'line',
    data: {
      labels: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', 'Now'],
      datasets: [
        {
          label: 'Motion Events',
          data: [1, 2, 6, 11, 15, 12, 18],
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.08)',
          fill: true,
          tension: 0.4,
          borderWidth: 2.5,
          pointRadius: 3,
          pointHoverRadius: 6,
          pointBackgroundColor: '#10b981'
        },
        {
          label: 'Distance Alerts',
          data: [0, 1, 4, 8, 9, 7, 10],
          borderColor: '#8b5cf6',
          backgroundColor: 'rgba(139, 92, 246, 0.08)',
          fill: true,
          tension: 0.4,
          borderWidth: 2.5,
          pointRadius: 3,
          pointHoverRadius: 6,
          pointBackgroundColor: '#8b5cf6'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f172a',
          titleFont: { family: 'Plus Jakarta Sans', size: 12 },
          bodyFont: { family: 'Plus Jakarta Sans', size: 11 },
          padding: 10,
          cornerRadius: 8
        }
      },
      scales: {
        x: {
          grid: {
            display: false,
            color: isDark ? '#334155' : '#f1f5f9'
          },
          ticks: {
            font: { family: 'Plus Jakarta Sans', size: 10 },
            color: isDark ? '#94a3b8' : '#64748b'
          }
        },
        y: {
          grid: {
            color: isDark ? '#334155' : '#f1f5f9'
          },
          ticks: {
            font: { family: 'Plus Jakarta Sans', size: 10 },
            color: isDark ? '#94a3b8' : '#64748b',
            stepSize: 5
          }
        }
      }
    }
  });
}

/* ========================================================
   RECENT ALERTS TABLE RENDERING & FILTERING
======================================================== */
function renderAlertsTable(alerts) {
  const tbody = document.getElementById('alertsTableBody');
  if (!tbody) return;

  if (alerts.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center py-8 text-slate-400">
          <i data-lucide="inbox" class="w-8 h-8 mx-auto mb-2 opacity-50"></i>
          No alerts match the selected filter.
        </td>
      </tr>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  tbody.innerHTML = alerts.map(alert => {
    // Status Badge Color
    let statusClass = 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800';
    if (alert.status === 'Critical') {
      statusClass = 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 border-rose-200 dark:border-rose-800';
    } else if (alert.status === 'Warning') {
      statusClass = 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-800';
    }

    // Severity Badge Color (Danger vs Caution)
    const severity = alert.severity || (alert.status === 'Critical' ? 'Danger' : 'Caution');
    let severityClass = 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border-amber-300 dark:border-amber-800';
    if (severity === 'Danger') {
      severityClass = 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border-rose-300 dark:border-rose-800 animate-pulse';
    }

    // Type Icon
    let typeIcon = 'activity';
    if (alert.type.includes('Person')) typeIcon = 'user';
    else if (alert.type.includes('Harmful') || alert.type.includes('Danger')) typeIcon = 'alert-octagon';
    else if (alert.type.includes('Sound')) typeIcon = 'volume-2';
    else if (alert.source === 'Ultrasonic' || alert.type.includes('Close Object')) typeIcon = 'ruler';

    // AI Check Badge or Note
    let aiCheckBadge = '';
    if (alert.aiCheck === 'confirmed') {
      aiCheckBadge = `<span class="ml-1.5 px-1.5 py-0.2 rounded text-[9px] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-700 inline-flex items-center gap-0.5"><i data-lucide="sparkles" class="w-2.5 h-2.5"></i>AI check</span>`;
    } else if (alert.aiCheck === 'unavailable') {
      aiCheckBadge = `<span class="ml-1.5 px-1.5 py-0.2 rounded text-[9px] font-medium bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-300 dark:border-slate-700">AI check unavailable</span>`;
    }

    // Step 6: Email Status Badge (Emailed vs Email failed vs none)
    let emailStatusBadge = '';
    if (alert.emailStatus === 'sent') {
      emailStatusBadge = `<span class="ml-1.5 px-1.5 py-0.2 rounded text-[9px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 inline-flex items-center gap-0.5" title="Alert email sent to owner"><i data-lucide="mail-check" class="w-2.5 h-2.5"></i>Emailed</span>`;
    } else if (alert.emailStatus === 'failed') {
      emailStatusBadge = `<span class="ml-1.5 px-1.5 py-0.2 rounded text-[9px] font-semibold bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border border-rose-300 dark:border-rose-700 inline-flex items-center gap-0.5" title="${alert.emailError || 'Email delivery failed'}"><i data-lucide="mail-x" class="w-2.5 h-2.5"></i>Email failed</span>`;
    }

    return `
      <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
        <td class="py-3.5 px-4 font-mono text-slate-500 dark:text-slate-400">${alert.time}</td>
        <td class="py-3.5 px-4">
          <span class="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${severityClass}">
            ${severity}
          </span>
        </td>
        <td class="py-3.5 px-4">
          <div class="flex items-center space-x-2">
            <span class="p-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              <i data-lucide="${typeIcon}" class="w-3.5 h-3.5"></i>
            </span>
            <span class="font-semibold text-slate-800 dark:text-slate-200">${alert.type}</span>
            ${aiCheckBadge}
            ${emailStatusBadge}
          </div>
        </td>
        <td class="py-3.5 px-4 text-slate-500 dark:text-slate-400">${alert.source}</td>
        <td class="py-3.5 px-4 font-mono ${alert.distance !== 'N/A' && parseInt(alert.distance) < 50 ? 'text-rose-600 font-bold' : ''}">
          ${alert.distance}
        </td>
        <td class="py-3.5 px-4">
          <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${statusClass}">
            ${alert.status}
          </span>
        </td>
        <td class="py-3.5 px-4 text-right">
          <button onclick="showAlertDetails(${alert.id})" class="text-emerald-600 dark:text-emerald-400 hover:underline font-semibold text-xs">
            View
          </button>
        </td>
      </tr>
    `;
  }).join('');

  const countBadge = document.getElementById('tableShowingCount');
  if (countBadge) {
    countBadge.textContent = `Showing ${alerts.length} of ${state.alerts.length} records`;
  }

  if (window.lucide) lucide.createIcons();
}

function filterAlertTable() {
  const searchTerm = (document.getElementById('alertTableSearch')?.value || '').toLowerCase();
  const filterSeverity = document.getElementById('filterSeverity')?.value || 'ALL';
  const filterType = document.getElementById('filterType')?.value || 'ALL';
  const filterSource = document.getElementById('filterSource')?.value || 'ALL';
  const filterStatus = document.getElementById('filterStatus')?.value || 'ALL';

  const filtered = state.alerts.filter(item => {
    const itemSeverity = item.severity || (item.status === 'Critical' ? 'Danger' : 'Caution');
    const matchesSearch = 
      (item.type || '').toLowerCase().includes(searchTerm) ||
      (item.source || '').toLowerCase().includes(searchTerm) ||
      (item.time || '').toLowerCase().includes(searchTerm) ||
      (item.details || '').toLowerCase().includes(searchTerm) ||
      (item.distance || '').toLowerCase().includes(searchTerm) ||
      itemSeverity.toLowerCase().includes(searchTerm);

    const matchesSeverity = (filterSeverity === 'ALL') || (itemSeverity === filterSeverity);
    const matchesType = (filterType === 'ALL') || (item.type === filterType) || ((item.type || '').includes(filterType));
    const matchesSource = (filterSource === 'ALL') || (item.source === filterSource) || ((item.source || '').includes(filterSource));
    const matchesStatus = (filterStatus === 'ALL') || (item.status === filterStatus);

    return matchesSearch && matchesSeverity && matchesType && matchesSource && matchesStatus;
  });

  renderAlertsTable(filtered);
}

function showAlertDetails(id) {
  const alert = state.alerts.find(a => a.id === id);
  if (!alert) return;
  alertBanner(`Anomaly Detail: ${alert.type} at ${alert.time} via ${alert.source} (Distance: ${alert.distance})`);
}

/* ========================================================
   ALERT BANNER MANAGEMENT (CAUTION YELLOW / DANGER RED)
======================================================== */
function triggerAlertBanner(message, level = 'danger') {
  const banner = document.getElementById('alertBanner');
  const text = document.getElementById('alertBannerText');
  const badge = document.getElementById('alertBannerBadge');
  const iconBox = document.getElementById('alertBannerIconBox');
  const icon = document.getElementById('alertBannerIcon');
  const devWarn = document.getElementById('alertBannerDeviceWarning');

  if (banner && text) {
    text.textContent = message;

    if (level === 'caution') {
      banner.className = 'animate-slide-down bg-amber-500 text-slate-950 px-4 py-3 shadow-lg sticky top-0 z-50 flex items-center justify-between';
      if (badge) {
        badge.textContent = 'Caution';
        badge.className = 'font-bold uppercase tracking-wider text-xs bg-amber-600 text-white px-2 py-0.5 rounded';
      }
      if (iconBox) iconBox.className = 'p-1.5 bg-amber-600 rounded-full animate-bounce';
      if (icon) icon.className = 'w-5 h-5 text-white';
      if (devWarn) devWarn.classList.add('hidden');
    } else {
      // Danger or Critical (Red)
      banner.className = 'animate-slide-down bg-rose-600 text-white px-4 py-3 shadow-lg sticky top-0 z-50 flex items-center justify-between';
      if (badge) {
        badge.textContent = level === 'danger' ? 'DANGER ALERT' : 'CRITICAL ALERT';
        badge.className = 'font-bold uppercase tracking-wider text-xs bg-rose-800 text-white px-2 py-0.5 rounded';
      }
      if (iconBox) iconBox.className = 'p-1.5 bg-rose-700 rounded-full animate-bounce';
      if (icon) icon.className = 'w-5 h-5 text-white';

      // Check if ESP32 device buzzer is connected
      if (devWarn) {
        if (!state.serialConnected || !serialWriter) {
          devWarn.classList.remove('hidden');
        } else {
          devWarn.classList.add('hidden');
        }
      }
    }

    banner.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (window.lucide) lucide.createIcons();
  }
}

function dismissAlertBanner() {
  const banner = document.getElementById('alertBanner');
  if (banner) {
    banner.classList.add('hidden');
  }
}

/* ========================================================
   MODAL & QUICK BUTTON ACTIONS
======================================================== */
/* ========================================================
   WEB SERIAL API & ESP32 HARDWARE INTEGRATION (STEP 2)
======================================================== */

// Check if Web Serial API is supported in this browser
function isSerialSupported() {
  return 'serial' in navigator;
}

// Update Top Stat Cards (Alerts Today, Motion Events, etc.)
function updateStatsDisplay() {
  const statAlerts = document.getElementById('statAlertsToday');
  const statMotion = document.getElementById('statMotionEvents');
  const statObjects = document.getElementById('statObjectsDetected');
  const statSound = document.getElementById('statSoundAlerts');

  if (statAlerts) statAlerts.textContent = state.stats.alertsToday;
  if (statMotion) statMotion.textContent = state.stats.motionEvents;
  if (statObjects) statObjects.textContent = state.stats.objectsDetected;
  if (statSound) statSound.textContent = state.stats.soundAlerts;
}

async function handleConnectSerial() {
  if (!isSerialSupported()) {
    alert('Web Serial is not supported in this browser. Please open this page in Google Chrome or Microsoft Edge.');
    return;
  }

  // If already connected or loop running, disconnect cleanly first
  if (state.serialConnected || serialPort) {
    await disconnectSerial();
    return;
  }

  // Directly request user to select port (browser native prompt)
  await requestSerialPort();
}

function closeConnectModal() {
  const modal = document.getElementById('connectModal');
  if (modal) modal.classList.add('hidden');
}

async function requestSerialPort() {
  closeConnectModal();

  // Clean up any stale handles before opening a new connection
  await cleanupSerialHandles();

  try {
    // Request a port and open at 115200 baud
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: 115200 });

    state.serialConnected = true;
    updateSerialUI(true);

    // Setup writer for sending commands
    serialEncoder = new TextEncoderStream();
    serialEncoder.readable.pipeTo(serialPort.writable).catch(err => {
      console.warn('Writable stream error / closed:', err);
    });
    serialWriter = serialEncoder.writable.getWriter();

    // Start reading loop & watchdog
    keepReading = true;
    startSerialWatchdog();
    readSerialData();

    triggerAlertBanner('✅ ESP32 Connected at 115200 baud! Receiving live telemetry.', 'caution');
    setTimeout(() => dismissAlertBanner(), 3500);
  } catch (err) {
    console.error('Serial connection error:', err);
    await cleanupSerialHandles();
    if (err.name !== 'NotFoundError') {
      logSerialError(`Connect error: ${err.message}. Ensure no other app (e.g. Arduino Serial Monitor) is using this port.`);
      alert(`Could not connect to serial port: ${err.message}\nMake sure no other program (e.g. Arduino Serial Monitor) is using this COM port.`);
    }
  }
}

async function cleanupSerialHandles() {
  keepReading = false;
  stopSerialWatchdog();

  try {
    if (serialReader) {
      try { await serialReader.cancel(); } catch (e) {}
      try { serialReader.releaseLock(); } catch (e) {}
      serialReader = null;
    }
  } catch (e) {}

  try {
    if (serialWriter) {
      try { await serialWriter.close(); } catch (e) {}
      try { serialWriter.releaseLock(); } catch (e) {}
      serialWriter = null;
    }
  } catch (e) {}
  serialEncoder = null;

  try {
    if (serialPort) {
      try { await serialPort.close(); } catch (e) {}
      serialPort = null;
    }
  } catch (e) {}

  isSerialLoopRunning = false;
  state.serialConnected = false;
}

async function disconnectSerial() {
  await cleanupSerialHandles();
  updateSerialUI(false);
  triggerAlertBanner('ℹ️ ESP32 Disconnected.', 'caution');
  setTimeout(() => dismissAlertBanner(), 2500);
}

function updateSerialUI(connected) {
  const btn = document.getElementById('connectSerialBtn');
  const btnText = document.getElementById('serialBtnText');
  const statusBadge = document.getElementById('serialStatusBadge');
  const espBadge = document.getElementById('esp32ConnBadge');

  if (connected) {
    if (btn) btn.className = 'px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-semibold text-xs flex items-center space-x-2 transition shadow-lg shadow-rose-500/20 active:scale-95';
    if (btnText) btnText.textContent = 'Disconnect Device';
    if (statusBadge) statusBadge.className = 'w-2 h-2 rounded-full bg-white animate-pulse';
    if (espBadge) {
      espBadge.textContent = 'Connected (115200)';
      espBadge.className = 'text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400';
    }
  } else {
    if (btn) btn.className = 'px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold text-xs flex items-center space-x-2 transition shadow-lg shadow-emerald-500/20 active:scale-95';
    if (btnText) btnText.textContent = 'Connect Device';
    if (statusBadge) statusBadge.className = 'w-2 h-2 rounded-full bg-slate-900/40';
    if (espBadge) {
      espBadge.textContent = 'Disconnected';
      espBadge.className = 'text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
    }
  }

  // Update warnings for alarm output
  updateAlarmWarningVisibility();
  if (window.lucide) lucide.createIcons();
}

/**
 * Watchdog timer: checks every 1000ms if data arrived within the last 3000ms
 */
function startSerialWatchdog() {
  stopSerialWatchdog();
  serialLastReceiveTime = Date.now();
  serialWatchdogTimer = setInterval(() => {
    if (!state.serialConnected) {
      hideInactivityWarning();
      return;
    }
    const elapsed = Date.now() - serialLastReceiveTime;
    if (elapsed >= 3000) {
      showInactivityWarning();
    } else {
      hideInactivityWarning();
    }
  }, 1000);
}

function stopSerialWatchdog() {
  if (serialWatchdogTimer) {
    clearInterval(serialWatchdogTimer);
    serialWatchdogTimer = null;
  }
  hideInactivityWarning();
}

function showInactivityWarning() {
  const warn = document.getElementById('serialInactivityWarning');
  if (warn && warn.classList.contains('hidden')) {
    warn.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }
}

function hideInactivityWarning() {
  const warn = document.getElementById('serialInactivityWarning');
  if (warn && !warn.classList.contains('hidden')) {
    warn.classList.add('hidden');
  }
}

function logSerialError(msg) {
  const errBox = document.getElementById('serialErrorLog');
  if (errBox) {
    errBox.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    errBox.classList.remove('hidden');
  }
}

function pushRawLineToDebug(rawLine) {
  serialLineCount++;
  serialLastReceiveTime = Date.now();
  hideInactivityWarning();

  // Add to circular array of 10 items
  const timeStr = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  serialRecentLines.unshift({ time: timeStr, text: rawLine });
  if (serialRecentLines.length > 10) {
    serialRecentLines.pop();
  }

  // Update DOM debug panel
  const counterEl = document.getElementById('serialLinesCount');
  if (counterEl) {
    counterEl.textContent = serialLineCount;
  }

  const windowEl = document.getElementById('serialDebugLogWindow');
  if (windowEl) {
    windowEl.innerHTML = serialRecentLines.map((item, idx) => `
      <div class="flex items-center space-x-1.5 truncate ${idx === 0 ? 'text-emerald-300 font-semibold' : 'text-slate-400'}">
        <span class="text-[9px] text-slate-500 font-mono">[${item.time}]</span>
        <span class="font-mono text-[10px] break-all">${escapeHtml(item.text)}</span>
      </div>
    `).join('');
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Main Web Serial Reader Loop (Guaranteed Single Runner)
 */
async function readSerialData() {
  if (isSerialLoopRunning) {
    console.warn('Serial reader loop is already active. Ignoring duplicate invocation.');
    return;
  }

  isSerialLoopRunning = true;
  serialBuffer = '';

  const textDecoder = new TextDecoderStream();
  const readableStreamClosed = serialPort.readable.pipeTo(textDecoder.writable).catch(err => {
    console.warn('Readable stream pipe error / closed:', err);
  });
  serialReader = textDecoder.readable.getReader();

  try {
    while (keepReading) {
      const { value, done } = await serialReader.read();
      if (done) {
        break;
      }
      if (value) {
        serialBuffer += value;

        // Split on newline characters (\r\n or \n)
        const parts = serialBuffer.split(/\r?\n/);

        // Keep the last partial/incomplete chunk in serialBuffer
        serialBuffer = parts.pop();

        // Process all complete lines
        for (const rawPart of parts) {
          // Trim \r and extra spaces
          const trimmed = rawPart.replace(/\r/g, '').trim();
          if (trimmed.length > 0) {
            pushRawLineToDebug(trimmed);
            handleSerialLine(trimmed);
          }
        }
      }
    }
  } catch (err) {
    console.error('Serial read loop error:', err);
    logSerialError(`Read loop error: ${err.message}`);
  } finally {
    try {
      if (serialReader) {
        serialReader.releaseLock();
      }
    } catch (e) {}
    isSerialLoopRunning = false;
  }
}

/**
 * Tolerant Line Parser:
 * Matches "PIR:0,DIST:72", "PIR: 1, DIST: 45", etc.
 * Ignores banner/boot text like "READY", "BOOT", etc.
 * Wrapped in try/catch to ensure stream processing never crashes.
 */
function handleSerialLine(line) {
  try {
    // Tolerant regex allowing spaces: /PIR:\s*(\d)\s*,\s*DIST:\s*(\d+)/i
    const match = line.match(/PIR:\s*(\d)\s*,\s*DIST:\s*(\d+)/i);
    if (!match) {
      // Ignored non-telemetry line (e.g. "READY", "ESP-ROM:esp32s3...")
      return;
    }

    const pir = parseInt(match[1], 10);
    const rawDist = parseInt(match[2], 10);

    const prevPir = state.previousPir !== undefined ? state.previousPir : state.currentPir;
    state.currentPir = pir;
    state.currentDist = rawDist;

    // 1. Update live DOM elements (meters, progress bar, badges)
    updateLiveSensorDisplay(pir, rawDist);

    // 2. Update telemetry chart activity in real-time
    updateTelemetryChart(pir, rawDist);

    // 3. Process new sensor alert rules (PIR alone, Close object alone, Both together)
    evaluateSensorRules(pir, prevPir, rawDist);

    // Save current PIR as previous for next transition check
    state.previousPir = pir;
  } catch (err) {
    console.error('Error in handleSerialLine:', err);
    logSerialError(`Parse error: ${err.message}`);
  }
}

/**
 * Sensor Rule Evaluator (Step 7):
 * Evaluates:
 * 1. Ignore DIST values of 999 and values < 2 (out of range/no echo).
 * 2. PIR motion alone (PIR 0 -> 1): Caution alert (Source = PIR), follows Sensor alert sound setting.
 * 3. Close object alone (DIST < threshold, 2 in a row, with no PIR motion): Caution alert (Source = Ultrasonic), follows Sensor alert sound setting.
 * 4. Both together (PIR is 1 and DIST < threshold, simultaneously or within 5s): DANGER alert "Motion + Close Object", exactly ONE short beep (~150ms).
 * 5. Hysteresis: close object starts at 2 readings in a row < threshold, ends when DIST > threshold + 10.
 * 6. Cooldown: 5 seconds per alert type (beep sounds have 3-second cooldown).
 * 7. Debug panel logging of last DIST, PIR state, and firing rule or reason none fired.
 */
function evaluateSensorRules(pir, prevPir, rawDist) {
  const now = Date.now();
  const threshold = state.closeObjectDistance || 50;
  const resetThreshold = threshold + 10; // Hysteresis clear limit (e.g. > 60 cm for 50 cm threshold)

  // Validate ultrasonic distance (Rule 5: Ignore 999 and < 2)
  const isDistValid = (rawDist !== 999 && rawDist >= 2);

  // Update PIR activity timestamp whenever PIR === 1
  if (pir === 1) {
    state.lastPirMotionTime = now;
  }

  // Update Distance Hysteresis & consecutive reading counter
  if (isDistValid) {
    if (rawDist < threshold) {
      state.consecutiveCloseDistReadings++;
      state.lastCloseDistTime = now;
      if (state.consecutiveCloseDistReadings >= 2) {
        state.isCloseObjectStateActive = true;
      }
    } else if (rawDist > resetThreshold) {
      state.consecutiveCloseDistReadings = 0;
      state.isCloseObjectStateActive = false;
    }
  } else {
    // If distance reading is invalid/999, reset consecutive counter
    state.consecutiveCloseDistReadings = 0;
  }

  // Check temporal correlation: PIR was active and close object was active within 5 seconds
  const isPirRecentlyActive = (pir === 1) || (now - state.lastPirMotionTime <= 5000);
  const isCloseDistRecentlyActive = (isDistValid && rawDist < threshold) || (now - state.lastCloseDistTime <= 5000);

  let ruleOutcome = '';

  // -------------------------------------------------------------
  // RULE 3: Both Together (PIR is 1 and DIST under threshold, simultaneously or within 5s)
  // Raise DANGER alert "Motion + Close Object" with RED banner and ONE short beep
  // -------------------------------------------------------------
  if (isPirRecentlyActive && isCloseDistRecentlyActive && state.isCloseObjectStateActive) {
    ruleOutcome = `DANGER: Both fired (PIR=1, DIST=${rawDist}cm < ${threshold}cm)`;
    updateSensorDebugDisplay(rawDist, pir, ruleOutcome, 'danger');
    onBothMotionAndCloseAlert(rawDist);
    return;
  }

  // -------------------------------------------------------------
  // RULE 1: PIR Motion alone (PIR goes from 0 to 1)
  // Raise Caution alert (Source = PIR). Sound follows "Sensor alert sound" setting.
  // -------------------------------------------------------------
  if (prevPir === 0 && pir === 1) {
    ruleOutcome = 'Caution: PIR motion alone (0 -> 1)';
    updateSensorDebugDisplay(rawDist, pir, ruleOutcome, 'caution');
    onPirMotionAloneAlert(rawDist);
    return;
  }

  // -------------------------------------------------------------
  // RULE 2: Close Object alone (DIST under threshold for 2 readings, no PIR motion)
  // Raise Caution alert (Source = Ultrasonic), follows "Sensor alert sound" setting.
  // -------------------------------------------------------------
  if (state.closeObjectAlertEnabled && isDistValid && state.isCloseObjectStateActive && pir === 0 && !isPirRecentlyActive) {
    ruleOutcome = `Caution: Close object alone (${rawDist}cm < ${threshold}cm, PIR=0)`;
    updateSensorDebugDisplay(rawDist, pir, ruleOutcome, 'caution');
    onCloseObjectAloneAlert(rawDist);
    return;
  }

  // -------------------------------------------------------------
  // No Rule Fired: Report diagnostic explanation in Debug Panel
  // -------------------------------------------------------------
  if (!isDistValid) {
    ruleOutcome = rawDist === 999 ? 'No rule: DIST 999 (No echo/ignored)' : `No rule: DIST ${rawDist} (< 2cm/ignored)`;
  } else if (!state.closeObjectAlertEnabled) {
    ruleOutcome = `No rule: Close object alert OFF (DIST ${rawDist}cm, PIR ${pir})`;
  } else if (pir === 0 && rawDist >= threshold) {
    ruleOutcome = `No rule: DIST ${rawDist}cm >= ${threshold}cm (Above limit), PIR=0`;
  } else if (pir === 0 && rawDist < threshold && state.consecutiveCloseDistReadings < 2) {
    ruleOutcome = `No rule: DIST ${rawDist}cm < ${threshold}cm (Reading 1 of 2, debouncing)`;
  } else if (pir === 1 && rawDist >= threshold) {
    ruleOutcome = `No rule: PIR=1 active (sustained), DIST ${rawDist}cm >= ${threshold}cm`;
  } else {
    ruleOutcome = `Normal: DIST ${rawDist}cm, PIR ${pir}`;
  }

  updateSensorDebugDisplay(rawDist, pir, ruleOutcome, 'normal');
}

/**
 * Updates the Sensor Debug Panel display (Rule 8)
 */
function updateSensorDebugDisplay(dist, pir, ruleDescription, status = 'normal') {
  const readingEl = document.getElementById('debugSensorReading');
  const badgeEl = document.getElementById('debugSensorStateBadge');
  const ruleEl = document.getElementById('debugSensorRuleStatus');

  const distText = dist === 999 ? '999 (No Echo)' : `${dist} cm`;
  if (readingEl) {
    readingEl.textContent = `DIST: ${distText} | PIR: ${pir}`;
  }

  if (badgeEl) {
    if (status === 'danger') {
      badgeEl.textContent = 'DANGER';
      badgeEl.className = 'px-1.5 py-0.2 rounded text-[9px] font-bold bg-rose-950/80 text-rose-300 border border-rose-800 animate-pulse';
    } else if (status === 'caution') {
      badgeEl.textContent = 'CAUTION';
      badgeEl.className = 'px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-950/80 text-amber-300 border border-amber-800';
    } else {
      badgeEl.textContent = pir === 1 ? 'PIR Active' : (dist < 50 ? 'Close' : 'Clear');
      badgeEl.className = 'px-1.5 py-0.2 rounded text-[9px] bg-slate-800 text-slate-400';
    }
  }

  if (ruleEl) {
    ruleEl.textContent = ruleDescription;
    if (status === 'danger') {
      ruleEl.className = 'text-rose-400 font-bold';
    } else if (status === 'caution') {
      ruleEl.className = 'text-amber-400 font-semibold';
    } else {
      ruleEl.className = 'text-slate-400';
    }
  }
}

/**
 * Update activity line chart dynamically with live sensor samples
 */
function updateTelemetryChart(pir, dist) {
  if (!chartActivityOverTime) return;

  try {
    // Periodically pulse or update live telemetry point
    const datasetMotion = chartActivityOverTime.data.datasets[0];
    const datasetDist = chartActivityOverTime.data.datasets[1];

    if (datasetMotion && datasetDist) {
      const nowIdx = chartActivityOverTime.data.labels.length - 1;
      if (nowIdx >= 0) {
        if (pir === 1) {
          datasetMotion.data[nowIdx] = (datasetMotion.data[nowIdx] || 0) + 0.1;
        }
        if (dist < 50) {
          datasetDist.data[nowIdx] = (datasetDist.data[nowIdx] || 0) + 0.1;
        }
      }
    }
  } catch (e) {
    console.warn('Error updating live telemetry chart:', e);
  }
}

function updateLiveSensorDisplay(pir, dist) {
  // 1. Distance display
  const liveDist = document.getElementById('liveDistValue');
  const distBar = document.getElementById('distProgressBar');
  if (liveDist) {
    liveDist.textContent = dist === 999 ? 'No Echo' : dist;
  }
  if (distBar) {
    // Map distance (0 to 100 cm or clamped)
    const pct = Math.min(Math.max(dist, 5), 100);
    distBar.style.width = `${pct}%`;
    if (dist < 50) {
      distBar.className = 'bg-rose-500 h-1.5 rounded-full transition-all duration-200';
    } else {
      distBar.className = 'bg-emerald-500 h-1.5 rounded-full transition-all duration-200';
    }
  }

  // 2. PIR Motion Display
  const livePir = document.getElementById('livePirValue');
  const pirLight = document.getElementById('pirIndicatorLight');
  if (livePir) {
    livePir.textContent = pir === 1 ? 'PIR: 1 (MOTION DETECTED!)' : 'PIR: 0 (No Motion)';
    livePir.className = pir === 1 
      ? 'text-sm font-bold text-rose-600 dark:text-rose-400' 
      : 'text-sm font-bold text-slate-900 dark:text-white';
  }
  if (pirLight) {
    pirLight.className = pir === 1 
      ? 'w-3 h-3 rounded-full bg-rose-500 animate-ping' 
      : 'w-3 h-3 rounded-full bg-slate-400';
  }
}

/* ========================================================
   SENSOR ALERT SOUND SETTING (DEVICE / LAPTOP / BOTH / SILENT)
======================================================== */
function handleSensorAlertSoundChange(val) {
  setSensorAlertSound(val);
}

function setSensorAlertSound(val) {
  if (!['device', 'laptop', 'both', 'silent'].includes(val)) val = 'device';
  state.sensorAlertSound = val;
  localStorage.setItem('sensorAlertSound', val);
  applySensorAlertSoundUI(val);
}

function applySensorAlertSoundUI(val) {
  // Sync dashboard dropdown near Test Buzzer
  const dashSelect = document.getElementById('sensorAlertSoundSelect');
  if (dashSelect) dashSelect.value = val;

  // Sync 4-option segmented buttons in Settings modal
  const btnDevice = document.getElementById('optSensorSoundDevice');
  const btnLaptop = document.getElementById('optSensorSoundLaptop');
  const btnBoth = document.getElementById('optSensorSoundBoth');
  const btnSilent = document.getElementById('optSensorSoundSilent');

  const activeClass = 'bg-emerald-500 text-slate-950 shadow-md font-bold';
  const inactiveClass = 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700/60 font-medium';

  if (btnDevice) btnDevice.className = `py-2.5 px-2 rounded-lg text-xs text-center transition flex flex-col items-center gap-1 ${val === 'device' ? activeClass : inactiveClass}`;
  if (btnLaptop) btnLaptop.className = `py-2.5 px-2 rounded-lg text-xs text-center transition flex flex-col items-center gap-1 ${val === 'laptop' ? activeClass : inactiveClass}`;
  if (btnBoth) btnBoth.className = `py-2.5 px-2 rounded-lg text-xs text-center transition flex flex-col items-center gap-1 ${val === 'both' ? activeClass : inactiveClass}`;
  if (btnSilent) btnSilent.className = `py-2.5 px-2 rounded-lg text-xs text-center transition flex flex-col items-center gap-1 ${val === 'silent' ? activeClass : inactiveClass}`;

  if (window.lucide) lucide.createIcons();
}

/**
 * Triggers exactly ONE short beep (~150ms) for sensor alerts (PIR, Close Object, Motion + Close Object).
 * Follows "Sensor alert sound" setting:
 * - 'device': sends "BEEP\n" to ESP32 over serial. Laptop plays NOTHING.
 * - 'laptop': plays 150ms beep on laptop speaker.
 * - 'both': sends "BEEP\n" AND plays 150ms laptop beep.
 * - 'silent': plays nothing.
 * Cooldown: at most one beep every 3 seconds.
 */
async function triggerSensorBeep() {
  const now = Date.now();
  if (now - state.lastSensorBeepTime < 3000) {
    return; // Enforce at most one beep every 3 seconds
  }
  state.lastSensorBeepTime = now;

  const mode = state.sensorAlertSound || 'device';
  if (mode === 'silent') return;

  if (mode === 'device' || mode === 'both') {
    writeSerialCommand('BEEP\n').catch(err => {
      console.warn('Sensor BEEP serial write error:', err);
    });
  }

  if (mode === 'laptop' || mode === 'both') {
    playShortSensorBeep();
  }
}

/**
 * Plays exactly one short beep (~150ms) on laptop speaker
 */
function playShortSensorBeep() {
  try {
    const now = Date.now();
    state.lastAlarmSoundEndTime = Math.max(state.lastAlarmSoundEndTime, now + 150);
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime); // 880 Hz tone
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.15); // Exactly ~150ms short beep
  } catch (e) {
    console.log('Short laptop sensor beep error:', e);
  }
}

/* ========================================================
   ALARM OUTPUT SETTINGS (DEVICE ONLY / LAPTOP ONLY / BOTH)
======================================================== */

function handleAlarmOutputChange(val) {
  setAlarmOutput(val);
}

function setAlarmOutput(val) {
  if (!['device', 'laptop', 'both'].includes(val)) val = 'device';
  state.alarmOutput = val;
  localStorage.setItem('alarmOutput', val);
  applyAlarmOutputUI(val);
}

function applyAlarmOutputUI(val) {
  // Sync dropdown on top dashboard
  const topSelect = document.getElementById('alarmOutputSelect');
  if (topSelect) topSelect.value = val;

  // Sync 3-option segmented selector in Settings modal
  const btnDevice = document.getElementById('optAlarmDevice');
  const btnLaptop = document.getElementById('optAlarmLaptop');
  const btnBoth = document.getElementById('optAlarmBoth');

  const activeClass = 'bg-emerald-500 text-slate-950 shadow-md font-bold';
  const inactiveClass = 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700/60 font-medium';

  if (btnDevice && btnLaptop && btnBoth) {
    btnDevice.className = `py-2.5 px-2 rounded-lg text-xs text-center transition flex flex-col items-center gap-1 ${val === 'device' ? activeClass : inactiveClass}`;
    btnLaptop.className = `py-2.5 px-2 rounded-lg text-xs text-center transition flex flex-col items-center gap-1 ${val === 'laptop' ? activeClass : inactiveClass}`;
    btnBoth.className = `py-2.5 px-2 rounded-lg text-xs text-center transition flex flex-col items-center gap-1 ${val === 'both' ? activeClass : inactiveClass}`;
  }

  updateAlarmWarningVisibility();
  if (window.lucide) lucide.createIcons();
}

function updateAlarmWarningVisibility() {
  const needsDevice = state.alarmOutput === 'device' || state.alarmOutput === 'both';
  const isDisconnected = !state.serialConnected;
  const showWarning = needsDevice && isDisconnected;

  // Warning badge near Test Buzzer
  const badge = document.getElementById('alarmDeviceWarningBadge');
  if (badge) {
    if (showWarning) badge.classList.remove('hidden');
    else badge.classList.add('hidden');
  }

  // Warning notice inside Settings modal
  const notice = document.getElementById('settingsWarningNotice');
  if (notice) {
    if (showWarning) notice.classList.remove('hidden');
    else notice.classList.add('hidden');
  }
}

/* ========================================================
   PIR BUZZER TOGGLE SETTING (ON/OFF)
======================================================== */
function togglePirBuzzer(enabled) {
  state.pirBuzzer = !!enabled;
  localStorage.setItem('pirBuzzer', state.pirBuzzer);
  applyPirBuzzerUI(state.pirBuzzer);
}

function applyPirBuzzerUI(enabled) {
  const toggleDash = document.getElementById('pirBuzzerToggleDashboard');
  const toggleSettings = document.getElementById('pirBuzzerToggleSettings');
  const labelDash = document.getElementById('pirBuzzerLabelDashboard');
  const labelSettings = document.getElementById('pirBuzzerLabelSettings');

  const text = enabled ? 'PIR buzzer: ON' : 'PIR buzzer: OFF';

  if (toggleDash) toggleDash.checked = enabled;
  if (toggleSettings) toggleSettings.checked = enabled;
  if (labelDash) {
    labelDash.textContent = text;
    labelDash.className = enabled ? 'font-semibold text-emerald-400 text-xs' : 'font-semibold text-slate-400 text-xs';
  }
  if (labelSettings) {
    labelSettings.textContent = text;
    labelSettings.className = enabled ? 'text-xs font-bold text-emerald-600 dark:text-emerald-400' : 'text-xs font-bold text-slate-500 dark:text-slate-400';
  }
}

/* ========================================================
   CLOSE OBJECT ALERT & DISTANCE SETTING (STEP 7)
======================================================== */
function toggleCloseObjectAlert(enabled) {
  state.closeObjectAlertEnabled = !!enabled;
  localStorage.setItem('closeObjectAlertEnabled', state.closeObjectAlertEnabled);
  applyCloseObjectSettingsUI();
}

function handleCloseObjectDistanceChange(val) {
  let distVal = parseInt(val, 10);
  if (isNaN(distVal) || distVal < 10) distVal = 10;
  if (distVal > 200) distVal = 200;

  state.closeObjectDistance = distVal;
  localStorage.setItem('closeObjectDistance', distVal);
  applyCloseObjectSettingsUI();
}

function applyCloseObjectSettingsUI() {
  const toggle = document.getElementById('closeObjectAlertToggle');
  const label = document.getElementById('closeObjectAlertLabel');
  const slider = document.getElementById('closeObjectDistanceSlider');
  const input = document.getElementById('closeObjectDistanceInput');
  const display = document.getElementById('closeObjectDistanceDisplay');

  const enabled = state.closeObjectAlertEnabled;
  const dist = state.closeObjectDistance || 50;

  if (toggle) toggle.checked = enabled;
  if (label) {
    label.textContent = `Close alert: ${enabled ? 'ON' : 'OFF'}`;
    label.className = enabled ? 'text-xs font-bold text-slate-700 dark:text-slate-200' : 'text-xs font-bold text-slate-400';
  }
  if (slider) slider.value = dist;
  if (input) input.value = dist;
  if (display) display.textContent = `${dist} cm`;
}

/* ========================================================
   PERSON ALERT SOUND SETTING (CAUTION LEVEL)
======================================================== */
function setPersonAlertSound(val) {
  if (!['none', 'device', 'laptop'].includes(val)) val = 'none';
  state.personAlertSound = val;
  localStorage.setItem('personAlertSound', val);
  applyPersonAlertSoundUI(val);
}

function applyPersonAlertSoundUI(val) {
  const btnNone = document.getElementById('optPersonSoundNone');
  const btnDevice = document.getElementById('optPersonSoundDevice');
  const btnLaptop = document.getElementById('optPersonSoundLaptop');

  const activeClass = 'bg-amber-500 text-slate-950 shadow-md font-bold';
  const inactiveClass = 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700/60 font-medium';

  if (btnNone && btnDevice && btnLaptop) {
    btnNone.className = `py-2.5 px-2 rounded-lg text-xs text-center transition flex flex-col items-center gap-1 ${val === 'none' ? activeClass : inactiveClass}`;
    btnDevice.className = `py-2.5 px-2 rounded-lg text-xs text-center transition flex flex-col items-center gap-1 ${val === 'device' ? activeClass : inactiveClass}`;
    btnLaptop.className = `py-2.5 px-2 rounded-lg text-xs text-center transition flex flex-col items-center gap-1 ${val === 'laptop' ? activeClass : inactiveClass}`;
  }

  if (window.lucide) lucide.createIcons();
}

/* ========================================================
   MIC SENSITIVITY SETTING (LOW / MEDIUM / HIGH)
======================================================== */
function setMicSensitivity(val) {
  if (!['low', 'medium', 'high'].includes(val)) val = 'medium';
  state.micSensitivity = val;
  localStorage.setItem('micSensitivity', val);
  applyMicSensitivityUI(val);
}

function applyMicSensitivityUI(val) {
  const btnLow = document.getElementById('optMicSensLow');
  const btnMed = document.getElementById('optMicSensMedium');
  const btnHigh = document.getElementById('optMicSensHigh');
  const badge = document.getElementById('micSensitivityBadge');

  const activeClass = 'bg-amber-500 text-slate-950 shadow-md font-bold';
  const inactiveClass = 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700/60 font-medium';

  if (btnLow && btnMed && btnHigh) {
    btnLow.className = `py-2.5 px-2 rounded-lg text-xs text-center transition flex flex-col items-center gap-1 ${val === 'low' ? activeClass : inactiveClass}`;
    btnMed.className = `py-2.5 px-2 rounded-lg text-xs text-center transition flex flex-col items-center gap-1 ${val === 'medium' ? activeClass : inactiveClass}`;
    btnHigh.className = `py-2.5 px-2 rounded-lg text-xs text-center transition flex flex-col items-center gap-1 ${val === 'high' ? activeClass : inactiveClass}`;
  }

  if (badge) {
    const capitalized = val.charAt(0).toUpperCase() + val.slice(1);
    badge.textContent = capitalized;
  }
}

function saveGeminiApiKey() {
  const input = document.getElementById('geminiApiKeyInput');
  const overrideInput = document.getElementById('geminiModelOverrideInput');
  
  if (input) {
    const val = input.value.trim();
    state.geminiApiKey = val;
    localStorage.setItem('geminiApiKey', val);
  }

  if (overrideInput) {
    const overrideVal = overrideInput.value.trim();
    state.geminiModelOverride = overrideVal;
    localStorage.setItem('geminiModelOverride', overrideVal);
  }

  // Reset cached model so it re-discovers with new key/override
  state.geminiResolvedModel = null;
  triggerAlertBanner('✅ Gemini API settings saved! Querying models...', 'caution');
  setTimeout(() => dismissAlertBanner(), 3000);

  if (state.geminiApiKey) {
    discoverGeminiModels(state.geminiApiKey);
  }
}

function openSettingsModal() {
  applySensorAlertSoundUI(state.sensorAlertSound);
  applyAlarmOutputUI(state.alarmOutput);
  applyPersonAlertSoundUI(state.personAlertSound);
  applyPirBuzzerUI(state.pirBuzzer);
  applyCloseObjectSettingsUI();
  applyMicSensitivityUI(state.micSensitivity);
  const keyInput = document.getElementById('geminiApiKeyInput');
  const overrideInput = document.getElementById('geminiModelOverrideInput');
  if (keyInput) keyInput.value = state.geminiApiKey || '';
  if (overrideInput) overrideInput.value = state.geminiModelOverride || '';

  // Step 5 & 6: Email alerts settings UI
  applyEmailSettingsUI();

  const modal = document.getElementById('settingsModal');
  if (modal) modal.classList.remove('hidden');
}

function closeSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Low-level robust serial write helper
 * Sends string (e.g. "BUZZ\n") to ESP32 over serial.
 * - Shows in debug panel each BUZZ send with its time.
 * - Shows any serial write error in full in debug panel.
 * - If write fails, tries to release and reacquire writer once before giving up.
 */
async function writeSerialCommand(command = 'BUZZ\n') {
  const timeStr = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const debugBuzzer = document.getElementById('debugBuzzerStatus');

  if (!state.serialConnected || (!serialWriter && !serialPort)) {
    const errText = 'ESP32 not connected';
    console.warn(`Cannot send "${command.trim()}": ${errText}`);
    logSerialError(`Send "${command.trim()}" failed: ${errText}`);
    if (debugBuzzer) {
      debugBuzzer.textContent = `Not connected [${timeStr}]`;
      debugBuzzer.className = 'text-amber-400 font-mono text-[9px]';
    }
    return { success: false, error: errText };
  }

  // Helper to reacquire serial writer if missing or broken
  const reacquireWriter = () => {
    try {
      if (serialWriter) {
        try { serialWriter.releaseLock(); } catch (e) {}
        serialWriter = null;
      }
      if (serialPort && serialPort.writable) {
        serialEncoder = new TextEncoderStream();
        serialEncoder.readable.pipeTo(serialPort.writable).catch(err => {
          console.warn('Writable stream pipe error:', err);
        });
        serialWriter = serialEncoder.writable.getWriter();
        return true;
      }
    } catch (e) {
      console.error('Failed to reacquire serial writer:', e);
    }
    return false;
  };

  if (!serialWriter) {
    const ok = reacquireWriter();
    if (!ok) {
      const errText = 'Could not acquire serial writer handle';
      logSerialError(`[${timeStr}] Write error: ${errText}`);
      if (debugBuzzer) {
        debugBuzzer.textContent = `Writer error: ${errText} [${timeStr}]`;
        debugBuzzer.className = 'text-rose-400 font-mono text-[9px]';
      }
      return { success: false, error: errText };
    }
  }

  // Attempt 1: write to serialWriter
  try {
    if (command.includes('BUZZ') || command.includes('BEEP')) {
      const now = Date.now();
      state.lastBuzzSentTime = now;
      const soundDuration = command.includes('BEEP') ? 150 : 300;
      state.lastAlarmSoundEndTime = Math.max(state.lastAlarmSoundEndTime, now + soundDuration);
    }
    await serialWriter.write(command);
    console.log(`[${timeStr}] Sent "${command.trim()}" to ESP32 successfully`);
    if (debugBuzzer) {
      debugBuzzer.textContent = `Sent "${command.trim()}" at ${timeStr}`;
      debugBuzzer.className = 'text-emerald-400 font-mono text-[9.5px] font-bold';
    }
    return { success: true };
  } catch (err) {
    console.warn(`[${timeStr}] Initial write error: ${err.message}. Retrying after reacquiring writer...`, err);
    logSerialError(`[${timeStr}] Write failed (${err.message}), retrying writer...`);

    // Attempt 2: Release and reacquire writer once before giving up
    try {
      const reacquired = reacquireWriter();
      if (reacquired && serialWriter) {
        if (command.includes('BUZZ') || command.includes('BEEP')) {
          const now = Date.now();
          state.lastBuzzSentTime = now;
          const soundDuration = command.includes('BEEP') ? 150 : 300;
          state.lastAlarmSoundEndTime = Math.max(state.lastAlarmSoundEndTime, now + soundDuration);
        }
        await serialWriter.write(command);
        console.log(`[${timeStr}] Sent "${command.trim()}" successfully on retry!`);
        if (debugBuzzer) {
          debugBuzzer.textContent = `Sent "${command.trim()}" (retry) at ${timeStr}`;
          debugBuzzer.className = 'text-emerald-400 font-mono text-[9.5px] font-bold';
        }
        return { success: true };
      }
      throw new Error('Reacquired writer was null or unavailable');
    } catch (retryErr) {
      const fullErrMsg = `Serial write error: ${retryErr.message || retryErr}`;
      console.error(`[${timeStr}] Permanent serial write failure:`, retryErr);
      logSerialError(`[${timeStr}] ${fullErrMsg}`);
      if (debugBuzzer) {
        debugBuzzer.textContent = `Write error: ${retryErr.message || 'Failed'} [${timeStr}]`;
        debugBuzzer.className = 'text-rose-400 font-mono text-[9px]';
      }
      return { success: false, error: retryErr.message || String(retryErr) };
    }
  }
}

/**
 * Universal Alarm Sound & Buzzer Dispatcher
 * Triggered by:
 * 1. Automatic alerts (PIR+DIST, Person detection, Sound)
 * 2. Manual "Test Buzzer" button
 */
async function triggerAlarmOutput(alertTitle = 'Alert') {
  const mode = state.alarmOutput; // 'device', 'laptop', 'both'
  let triggeredDevice = false;
  let triggeredLaptop = false;

  // 1. ESP32 Device Buzzer (if mode is 'device' or 'both')
  if (mode === 'device' || mode === 'both') {
    const res = await writeSerialCommand('BUZZ\n');
    triggeredDevice = res.success;
  }

  // 2. Laptop Speaker Audio (if mode is 'laptop' or 'both')
  if (mode === 'laptop' || mode === 'both') {
    playLocalBeep();
    triggeredLaptop = true;
  }

  return { triggeredDevice, triggeredLaptop, mode };
}

function playLocalBeep() {
  try {
    const now = Date.now();
    state.lastAlarmSoundEndTime = Math.max(state.lastAlarmSoundEndTime, now + 600);
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime); // 880 Hz tone
    gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.6); // 600ms loud clear beep
  } catch (e) {
    console.log('Web audio beep:', e);
  }
}

// -------------------------------------------------------------
// RULE 1: PIR Motion alone (PIR goes from 0 to 1)
// Raise Caution alert, Source = PIR. Sound follows "Sensor alert sound" setting (single BEEP ~150ms).
// Cooldown: 5 seconds.
// -------------------------------------------------------------
async function onPirMotionAloneAlert(dist) {
  const now = Date.now();
  if (now - state.lastPirMotionAlertTime < 5000) return;
  state.lastPirMotionAlertTime = now;

  // 1. Show Caution banner
  triggerAlertBanner('⚠️ Caution: PIR Motion detected!', 'caution');

  // 2. Sound Buzzer logic: exactly ONE short beep (~150ms) according to Sensor Alert Sound setting
  await triggerSensorBeep();

  // 3. Add Caution alert row to Recent alerts table (Source = PIR)
  const distText = (dist === 999 || dist < 2) ? 'No Echo' : `${dist} cm`;
  const newAlert = {
    id: Date.now(),
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    severity: 'Caution',
    type: 'PIR Motion Detected',
    source: 'PIR',
    details: 'PIR Motion transition 0 -> 1',
    distance: distText,
    status: 'Warning',
    aiChecked: false,
    ts: now
  };
  state.alerts.unshift(newAlert);
  renderAlertsTable(state.alerts);

  // Save to Cloud Firestore & trigger email alert
  saveAlertToFirestore(newAlert);

  // 4. Update Stats counters
  state.stats.alertsToday += 1;
  state.stats.motionEvents += 1;
  updateStatsDisplay();

  // 5. Update charts
  if (chartAlertsByType) {
    chartAlertsByType.data.datasets[0].data[0] += 1; // Motion category
    chartAlertsByType.update();
  }
  const donutTotal = document.getElementById('donutTotalCount');
  const donutMotion = document.getElementById('donutCountMotion');
  if (donutTotal) donutTotal.textContent = state.stats.alertsToday;
  if (donutMotion) donutMotion.textContent = parseInt(donutMotion.textContent || 0) + 1;
}

// -------------------------------------------------------------
// RULE 2: Close object alone (DIST under threshold, no PIR motion)
// Raise Caution alert, Source = Ultrasonic, Details = "Object at <distance> cm".
// Sound follows "Sensor alert sound" setting (single BEEP ~150ms).
// Cooldown: 5 seconds.
// -------------------------------------------------------------
async function onCloseObjectAloneAlert(dist) {
  const now = Date.now();
  if (now - state.lastCloseObjectAlertTime < 5000) return;
  state.lastCloseObjectAlertTime = now;

  // 1. Show Caution banner
  triggerAlertBanner(`⚠️ Caution: Close object detected at ${dist} cm!`, 'caution');

  // 2. Sound Buzzer logic: exactly ONE short beep (~150ms) according to Sensor Alert Sound setting
  await triggerSensorBeep();

  // 3. Add Caution alert row to Recent alerts table
  const newAlert = {
    id: Date.now(),
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    severity: 'Caution',
    type: 'Close Object Detected',
    source: 'Ultrasonic',
    details: `Object at ${dist} cm`,
    distance: `${dist} cm`,
    status: 'Warning',
    aiChecked: false,
    ts: now
  };
  state.alerts.unshift(newAlert);
  renderAlertsTable(state.alerts);

  // Save to Cloud Firestore & trigger email alert
  saveAlertToFirestore(newAlert);

  // 4. Update Stats counters
  state.stats.alertsToday += 1;
  state.stats.objectsDetected += 1;
  updateStatsDisplay();

  // 5. Update charts
  if (chartAlertsByType) {
    chartAlertsByType.data.datasets[0].data[1] += 1; // Objects category
    chartAlertsByType.update();
  }
  const donutTotal = document.getElementById('donutTotalCount');
  const donutPerson = document.getElementById('donutCountPerson');
  if (donutTotal) donutTotal.textContent = state.stats.alertsToday;
  if (donutPerson) donutPerson.textContent = parseInt(donutPerson.textContent || 0) + 1;
}

// -------------------------------------------------------------
// RULE 3: Both together (PIR is 1 and DIST under threshold, simultaneously or within 5s)
// Raise DANGER alert "Motion + Close Object" with RED Danger banner and Danger row.
// Sound: exactly ONE short beep (~150ms), NEVER continuous alarm. Follows "Sensor alert sound" setting.
// Cooldown: 5 seconds.
// -------------------------------------------------------------
async function onBothMotionAndCloseAlert(dist) {
  const now = Date.now();
  if (now - state.lastDangerMotionDistAlertTime < 5000) return;
  state.lastDangerMotionDistAlertTime = now;

  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // 1. Red banner (Danger banner, no continuous alarm)
  triggerAlertBanner(`🚨 DANGER: Motion + Close Object within ${dist} cm!`, 'danger');

  // 2. Sound exactly ONE short beep (~150ms), NEVER a continuous alarm
  await triggerSensorBeep();

  // 3. Add to Recent alerts table
  const newAlert = {
    id: Date.now(),
    time: timeStr,
    severity: 'Danger',
    type: 'Motion + Close Object',
    source: 'PIR',
    details: `Motion + Close Object within ${dist} cm`,
    distance: `${dist} cm`,
    status: 'Critical',
    aiChecked: false,
    ts: now
  };
  state.alerts.unshift(newAlert);
  renderAlertsTable(state.alerts);

  // Save to Cloud Firestore & trigger email alert
  saveAlertToFirestore(newAlert);

  // 4. Update Stats counters
  state.stats.alertsToday += 1;
  state.stats.motionEvents += 1;
  updateStatsDisplay();

  // 5. Update charts
  if (chartAlertsByType) {
    chartAlertsByType.data.datasets[0].data[0] += 1;
    chartAlertsByType.update();
  }
  const donutTotal = document.getElementById('donutTotalCount');
  const donutMotion = document.getElementById('donutCountMotion');
  if (donutTotal) donutTotal.textContent = state.stats.alertsToday;
  if (donutMotion) donutMotion.textContent = parseInt(donutMotion.textContent || 0) + 1;
}

// Backward compatibility alias for legacy callers
async function onPirDistAlert(dist) {
  await onBothMotionAndCloseAlert(dist);
}

async function handleTestBuzzer() {
  const res = await triggerAlarmOutput('Test Buzzer');
  let note = '';
  if (res.mode === 'device') {
    note = state.serialConnected ? 'Sent "BUZZ\\n" to ESP32 device buzzer.' : 'Alarm set to Device only (Warning: Device not connected).';
  } else if (res.mode === 'laptop') {
    note = 'Playing alarm sound on laptop speakers only (No serial command sent).';
  } else {
    note = state.serialConnected ? 'Sent "BUZZ\\n" to ESP32 AND played on laptop speakers.' : 'Played on laptop speakers (Warning: ESP32 device not connected).';
  }

  triggerAlertBanner(`🔊 Test Alarm: ${note}`);
  setTimeout(() => {
    dismissAlertBanner();
  }, 4000);
}

/* ========================================================
   STEP 3: CAMERA OBJECT DETECTION (LAYER 1 YOLO11 + LAYER 2 VISION AI)
======================================================== */

async function toggleCamera() {
  if (state.cameraActive) {
    await stopCamera();
  } else {
    await startCamera();
  }
}

async function startCamera() {
  const video = document.getElementById('webcamVideo');
  const canvas = document.getElementById('detectionCanvas');
  const placeholder = document.getElementById('cameraPlaceholder');
  const errorBox = document.getElementById('cameraErrorBox');
  const errorMsg = document.getElementById('cameraErrorMsg');
  const hud = document.getElementById('cameraHud');
  const statusBadge = document.getElementById('cameraStatusBadge');
  const btnLabel = document.getElementById('cameraBtnLabel');
  const btn = document.getElementById('toggleCameraBtn');

  // Reset errors
  if (errorBox) errorBox.classList.add('hidden');

  // Check getUserMedia support
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (errorBox && errorMsg) {
      errorMsg.textContent = 'Camera not supported in this browser.';
      errorBox.classList.remove('hidden');
    }
    return;
  }

  // Update button to loading state
  if (btnLabel) btnLabel.textContent = 'Starting...';
  if (statusBadge) {
    statusBadge.textContent = 'Initializing Camera...';
    statusBadge.className = 'text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-400';
  }

  try {
    // 1. Request Webcam Stream
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: 'user'
      },
      audio: false
    });

    video.srcObject = cameraStream;
    await video.play();

    // Adjust canvas resolution to match video
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    // Show video & canvas, hide placeholder
    video.classList.remove('hidden');
    canvas.classList.remove('hidden');
    if (placeholder) placeholder.classList.add('hidden');
    if (hud) hud.classList.remove('hidden');

    state.cameraActive = true;
    state.recentFramesHistory = [];

    // 2. Load YOLO11 ONNX Runtime Web Model
    if (!yoloSession && !isModelLoading) {
      if (statusBadge) statusBadge.textContent = 'Loading YOLO11...';
      const hudStatus = document.getElementById('hudPersonStatus');
      if (hudStatus) hudStatus.textContent = 'Loading YOLO11 ONNX...';

      isModelLoading = true;
      await initYoloSession();
      isModelLoading = false;
    }

    // Update UI to running state
    if (btnLabel) btnLabel.textContent = 'Stop Camera';
    if (btn) btn.className = 'px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-medium text-xs transition active:scale-95 flex items-center gap-1.5';
    if (statusBadge) {
      statusBadge.textContent = `Live • YOLO11 (${yoloProvider.toUpperCase()})`;
      statusBadge.className = 'text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400';
    }

    // Update Debug Panel: Model loaded
    const dbgLoaded = document.getElementById('debugModelLoaded');
    const dbgBackend = document.getElementById('debugBackendBadge');
    if (dbgLoaded) {
      dbgLoaded.textContent = yoloSession ? 'Yes' : 'No';
      dbgLoaded.className = yoloSession ? 'font-bold text-emerald-400' : 'font-bold text-rose-400';
    }
    if (dbgBackend) {
      dbgBackend.textContent = `Backend: ${yoloProvider.toUpperCase()}`;
    }

    // 3. Start Object Detection Loop (~5 times/sec = 200ms)
    if (detectionIntervalId) clearInterval(detectionIntervalId);
    detectionIntervalId = setInterval(runObjectDetection, 200);

    // 4. Start Independent Layer 2 Vision AI periodic loop (runs every 5 seconds while camera is on)
    if (state.visionAiIntervalId) clearInterval(state.visionAiIntervalId);
    state.visionAiIntervalId = setInterval(() => {
      if (state.cameraActive && video && video.readyState >= 2) {
        triggerLayer2VisionAiCheck(video);
      }
    }, 5000);

  } catch (err) {
    console.error('Camera initialization error:', err);
    state.cameraActive = false;

    // Show clear error message
    if (placeholder) placeholder.classList.add('hidden');
    if (errorBox) {
      errorBox.classList.remove('hidden');
      if (errorMsg) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          errorMsg.textContent = 'Camera permission was denied.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          errorMsg.textContent = 'No camera device found on this laptop.';
        } else {
          errorMsg.textContent = `Camera error: ${err.message || 'Access failed'}`;
        }
      }
    }

    if (btnLabel) btnLabel.textContent = 'Start Camera';
    if (btn) btn.className = 'px-3.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-medium text-xs transition active:scale-95 flex items-center gap-1.5';
    if (statusBadge) {
      statusBadge.textContent = 'Camera Off';
      statusBadge.className = 'text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
    }
  }

  if (window.lucide) lucide.createIcons();
}

/**
 * Initialize ONNX Runtime Web session for YOLO11
 * Prefers WebGPU if available; falls back to WASM
 */
async function initYoloSession() {
  if (typeof ort === 'undefined') {
    throw new Error('ONNX Runtime Web library (ort) not loaded.');
  }

  // Detect WebGPU capability
  const hasWebGpu = typeof navigator !== 'undefined' && !!navigator.gpu;
  console.log('Hardware WebGPU available:', hasWebGpu);

  const providersToTry = hasWebGpu ? ['webgpu', 'wasm'] : ['wasm'];

  try {
    yoloSession = await ort.InferenceSession.create('./yolo11n.onnx', {
      executionProviders: providersToTry,
      graphOptimizationLevel: 'all'
    });
    yoloProvider = hasWebGpu ? 'webgpu' : 'wasm';
    console.log(`YOLO11 session loaded with execution provider: ${yoloProvider}`);
  } catch (e) {
    console.warn('Failed with primary provider, falling back strictly to WASM:', e);
    yoloSession = await ort.InferenceSession.create('./yolo11n.onnx', {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    });
    yoloProvider = 'wasm';
    console.log('YOLO11 session loaded with fallback WASM');
  }
}

async function stopCamera() {
  // Clear detection interval
  if (detectionIntervalId) {
    clearInterval(detectionIntervalId);
    detectionIntervalId = null;
  }

  // Stop media stream tracks
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }

  const video = document.getElementById('webcamVideo');
  const canvas = document.getElementById('detectionCanvas');
  const placeholder = document.getElementById('cameraPlaceholder');
  const hud = document.getElementById('cameraHud');
  const statusBadge = document.getElementById('cameraStatusBadge');
  const btnLabel = document.getElementById('cameraBtnLabel');
  const btn = document.getElementById('toggleCameraBtn');
  const listEl = document.getElementById('detectedObjectsList');
  const countEl = document.getElementById('detectedObjectsCount');
  const visionStatus = document.getElementById('visionAiStatusIndicator');

  if (video) {
    video.pause();
    video.srcObject = null;
    video.classList.add('hidden');
  }

  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.classList.add('hidden');
  }

  if (placeholder) placeholder.classList.remove('hidden');
  if (hud) hud.classList.add('hidden');

  if (btnLabel) btnLabel.textContent = 'Start Camera';
  if (btn) btn.className = 'px-3.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-medium text-xs transition active:scale-95 flex items-center gap-1.5';

  if (statusBadge) {
    statusBadge.textContent = 'Camera Off';
    statusBadge.className = 'text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
  }

  if (listEl) listEl.innerHTML = '<span class="text-[11px] text-slate-400 italic">None detected</span>';
  if (countEl) countEl.textContent = '0';
  if (visionStatus) visionStatus.innerHTML = '<span>Ready</span>';

  state.cameraActive = false;
  state.detectedObjects = [];
  state.recentFramesHistory = [];
  if (window.lucide) lucide.createIcons();
}

/**
 * LAYER 1: Fast YOLO11 Detection Loop (Runs ~5 times/second)
 */
async function runObjectDetection() {
  if (!state.cameraActive || !yoloSession || isDetecting) return;
  const video = document.getElementById('webcamVideo');
  const canvas = document.getElementById('detectionCanvas');

  // Verify video is actually playing and ready (readyState >= 2, preferably 4)
  if (!video || video.readyState < 2 || !canvas) return;

  isDetecting = true;
  const startTime = performance.now();

  try {
    // 1. Preprocess Video Frame into [1, 3, 640, 640] with proper Letterboxing
    const { tensor: inputTensor, padX, padY, scale } = preprocessYoloWithLetterbox(video, 640, 640);

    // 2. Run ONNX Inference
    const inputName = yoloSession.inputNames[0];
    const feeds = { [inputName]: inputTensor };
    const results = await yoloSession.run(feeds);

    const outputName = yoloSession.outputNames[0];
    const outputTensor = results[outputName];

    // Measure Inference Time
    const inferenceDuration = Math.round(performance.now() - startTime);

    // 3. Postprocess YOLO11 output - supports [1, 84, 8400], [1, 8400, 84], or [1, 300, 6]
    // Lower threshold to 25% (0.25) so detections show up while testing
    const { detections: rawDetections, highestScore, topDetection } = postprocessYoloOutput(
      outputTensor,
      video.videoWidth,
      video.videoHeight,
      padX,
      padY,
      scale,
      0.25
    );

    // 4. Update Debug Panel with Raw Detections, Tensor Info & Inference stats
    updateDebugPanel(
      rawDetections,
      inferenceDuration,
      inputName,
      outputName,
      outputTensor.dims ? outputTensor.dims.join(' × ') : 'unknown',
      highestScore
    );

    // 5. Temporal False-Alarm Filter (seen in at least 3 of last 5 frames)
    const confirmedDetections = applyTemporalSmoothing(rawDetections);

    // Update confirmed count in debug panel
    const dbgConfirmed = document.getElementById('debugConfirmedCount');
    if (dbgConfirmed) dbgConfirmed.textContent = confirmedDetections.length;

    // 6. Render Bounding Boxes & Tags (Pass topDetection to draw even if below threshold)
    renderDetections(confirmedDetections, video, canvas, topDetection);

  } catch (err) {
    console.error('YOLO11 detection error:', err);
  } finally {
    isDetecting = false;
  }
}

/**
 * Preprocess Video Frame to CHW Float32 Tensor (640x640) with Aspect-Ratio Preserving Letterboxing
 */
function preprocessYoloWithLetterbox(video, targetW = 640, targetH = 640) {
  if (!preprocessYoloWithLetterbox.canvas) {
    preprocessYoloWithLetterbox.canvas = document.createElement('canvas');
    preprocessYoloWithLetterbox.canvas.width = targetW;
    preprocessYoloWithLetterbox.canvas.height = targetH;
    preprocessYoloWithLetterbox.ctx = preprocessYoloWithLetterbox.canvas.getContext('2d', { willReadFrequently: true });
  }

  const ctx = preprocessYoloWithLetterbox.ctx;
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;

  // Calculate scaling factor to fit inside 640x640 preserving aspect ratio
  const scale = Math.min(targetW / vw, targetH / vh);
  const scaledW = Math.round(vw * scale);
  const scaledH = Math.round(vh * scale);
  const padX = Math.floor((targetW - scaledW) / 2);
  const padY = Math.floor((targetH - scaledH) / 2);

  // Fill canvas with gray letterbox background (114/255 like standard YOLO)
  ctx.fillStyle = '#727272';
  ctx.fillRect(0, 0, targetW, targetH);

  // Draw video centered
  ctx.drawImage(video, 0, 0, vw, vh, padX, padY, scaledW, scaledH);

  const imgData = ctx.getImageData(0, 0, targetW, targetH);
  const pixels = imgData.data;

  const totalPixels = targetW * targetH;
  const inputData = new Float32Array(3 * totalPixels);

  // Channel-first (NCHW: R plane, then G plane, then B plane) normalized 0.0 - 1.0
  for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
    inputData[j] = pixels[i] / 255.0;                      // R
    inputData[totalPixels + j] = pixels[i + 1] / 255.0;    // G
    inputData[2 * totalPixels + j] = pixels[i + 2] / 255.0;// B
  }

  const tensor = new ort.Tensor('float32', inputData, [1, 3, targetH, targetW]);
  return { tensor, padX, padY, scale };
}

/**
 * Postprocess raw YOLO output supporting multiple ONNX export layouts:
 * 1. [1, 84, 8400]: Standard YOLOv8/YOLO11 output -> transpose across 8400 anchors
 * 2. [1, 8400, 84]: Already transposed anchor rows
 * 3. [1, 300, 6]: End-to-end export [x1, y1, x2, y2, score, classId]
 * 
 * Transforms coordinates from letterbox back to original video dimensions.
 * Also tracks the overall highest score and the top detection across the entire frame.
 */
function postprocessYoloOutput(outputTensor, origWidth, origHeight, padX, padY, scale, testThreshold = 0.25) {
  const data = outputTensor.data;
  const dims = outputTensor.dims || [1, 84, 8400];

  const boxes = [];
  const scores = [];
  const classIds = [];

  let highestScore = 0;
  let topDetection = null;

  // Case 3: End-to-end export [1, 300, 6] or similar [batch, num_detections, 6]
  if (dims.length === 3 && dims[2] === 6) {
    const numDets = dims[1];
    for (let i = 0; i < numDets; i++) {
      const offset = i * 6;
      const x1 = data[offset];
      const y1 = data[offset + 1];
      const x2 = data[offset + 2];
      const y2 = data[offset + 3];
      const score = data[offset + 4];
      const classId = Math.round(data[offset + 5]);

      if (score > highestScore) {
        highestScore = score;
        const oX = Math.max(0, (x1 - padX) / scale);
        const oY = Math.max(0, (y1 - padY) / scale);
        const oW = (x2 - x1) / scale;
        const oH = (y2 - y1) / scale;
        topDetection = {
          box: [oX, oY, oW, oH],
          score,
          classId,
          class: COCO_CLASSES[classId] || `Class ${classId}`
        };
      }

      if (score >= testThreshold) {
        const origX = Math.max(0, (x1 - padX) / scale);
        const origY = Math.max(0, (y1 - padY) / scale);
        const origW = (x2 - x1) / scale;
        const origH = (y2 - y1) / scale;
        boxes.push([origX, origY, origW, origH]);
        scores.push(score);
        classIds.push(classId);
      }
    }

    const detections = boxes.map((box, i) => ({
      box,
      score: scores[i],
      classId: classIds[i],
      class: COCO_CLASSES[classIds[i]] || `Class ${classIds[i]}`
    }));

    return { detections, highestScore, topDetection };
  }

  // Case 2: [1, 8400, 84] - Already rows of anchors
  if (dims.length === 3 && dims[1] >= 1000 && dims[2] === 84) {
    const numAnchors = dims[1];
    const numClasses = 80;

    for (let i = 0; i < numAnchors; i++) {
      const rowOffset = i * 84;
      let maxClassScore = 0;
      let bestClass = -1;

      for (let c = 0; c < numClasses; c++) {
        const sc = data[rowOffset + 4 + c];
        if (sc > maxClassScore) {
          maxClassScore = sc;
          bestClass = c;
        }
      }

      if (maxClassScore > highestScore) {
        highestScore = maxClassScore;
        const cx = data[rowOffset];
        const cy = data[rowOffset + 1];
        const w = data[rowOffset + 2];
        const h = data[rowOffset + 3];
        const oCx = (cx - padX) / scale;
        const oCy = (cy - padY) / scale;
        const oW = w / scale;
        const oH = h / scale;
        topDetection = {
          box: [Math.max(0, oCx - oW / 2), Math.max(0, oCy - oH / 2), oW, oH],
          score: maxClassScore,
          classId: bestClass,
          class: COCO_CLASSES[bestClass] || `Class ${bestClass}`
        };
      }

      if (maxClassScore >= testThreshold) {
        const cx = data[rowOffset];
        const cy = data[rowOffset + 1];
        const w = data[rowOffset + 2];
        const h = data[rowOffset + 3];
        const origCx = (cx - padX) / scale;
        const origCy = (cy - padY) / scale;
        const origW = w / scale;
        const origH = h / scale;
        boxes.push([Math.max(0, origCx - origW / 2), Math.max(0, origCy - origH / 2), origW, origH]);
        scores.push(maxClassScore);
        classIds.push(bestClass);
      }
    }
  } else {
    // Case 1 (Default official YOLO11): [1, 84, 8400] -> Transpose columns to rows
    const numFeatures = dims[1] || 84;
    const numAnchors = dims[2] || 8400;
    const numClasses = Math.max(1, numFeatures - 4); // 80 classes

    for (let i = 0; i < numAnchors; i++) {
      let maxClassScore = 0;
      let bestClass = -1;

      for (let c = 0; c < numClasses; c++) {
        const sc = data[(4 + c) * numAnchors + i];
        if (sc > maxClassScore) {
          maxClassScore = sc;
          bestClass = c;
        }
      }

      if (maxClassScore > highestScore) {
        highestScore = maxClassScore;
        const cx = data[0 * numAnchors + i];
        const cy = data[1 * numAnchors + i];
        const w = data[2 * numAnchors + i];
        const h = data[3 * numAnchors + i];
        const oCx = (cx - padX) / scale;
        const oCy = (cy - padY) / scale;
        const oW = w / scale;
        const oH = h / scale;
        topDetection = {
          box: [Math.max(0, oCx - oW / 2), Math.max(0, oCy - oH / 2), oW, oH],
          score: maxClassScore,
          classId: bestClass,
          class: COCO_CLASSES[bestClass] || `Class ${bestClass}`
        };
      }

      if (maxClassScore >= testThreshold) {
        const cx = data[0 * numAnchors + i];
        const cy = data[1 * numAnchors + i];
        const w = data[2 * numAnchors + i];
        const h = data[3 * numAnchors + i];

        const origCx = (cx - padX) / scale;
        const origCy = (cy - padY) / scale;
        const origW = w / scale;
        const origH = h / scale;

        const x1 = Math.max(0, origCx - origW / 2);
        const y1 = Math.max(0, origCy - origH / 2);

        boxes.push([x1, y1, origW, origH]);
        scores.push(maxClassScore);
        classIds.push(bestClass);
      }
    }
  }

  // Non-Maximum Suppression (IoU threshold = 0.45)
  const nmsIndices = nms(boxes, scores, 0.45);

  const detections = nmsIndices.map(idx => ({
    box: boxes[idx],
    score: scores[idx],
    classId: classIds[idx],
    class: COCO_CLASSES[classIds[idx]] || `Class ${classIds[idx]}`
  }));

  return { detections, highestScore, topDetection };
}

/**
 * Update Debug Panel with live stats
 */
function updateDebugPanel(rawDetections, inferenceTimeMs, inputName, outputName, outputShape, highestScore) {
  const dbgInference = document.getElementById('debugInferenceTime');
  const dbgRaw = document.getElementById('debugRawDetectionsCount');
  const dbgTop = document.getElementById('debugTopDetections');
  const dbgInput = document.getElementById('debugInputName');
  const dbgOutput = document.getElementById('debugOutputName');
  const dbgShape = document.getElementById('debugOutputShape');
  const dbgHigh = document.getElementById('debugHighestScore');

  if (dbgInference) dbgInference.textContent = `${inferenceTimeMs} ms`;
  if (dbgRaw) dbgRaw.textContent = rawDetections.length;
  if (dbgInput && inputName) dbgInput.textContent = inputName;
  if (dbgOutput && outputName) dbgOutput.textContent = outputName;
  if (dbgShape && outputShape) dbgShape.textContent = outputShape;
  if (dbgHigh) {
    dbgHigh.textContent = (highestScore || 0).toFixed(3);
    dbgHigh.className = highestScore >= 0.25 ? 'font-bold text-emerald-400' : 'font-bold text-amber-400';
  }

  if (dbgTop) {
    if (rawDetections.length === 0) {
      dbgTop.textContent = 'None (>= 0.25)';
      dbgTop.className = 'text-slate-500 italic';
    } else {
      // Sort descending by score
      const sorted = [...rawDetections].sort((a, b) => b.score - a.score).slice(0, 3);
      dbgTop.innerHTML = sorted.map(d => `${d.class} (${Math.round(d.score * 100)}%)`).join(', ');
      dbgTop.className = 'text-amber-400 font-semibold';
    }
  }
}

/**
 * Standard Greedy NMS
 */
function nms(boxes, scores, iouThreshold) {
  const indices = Array.from(Array(boxes.length).keys());
  indices.sort((a, b) => scores[b] - scores[a]);

  const selected = [];
  const active = new Array(boxes.length).fill(true);

  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    if (!active[idx]) continue;
    selected.push(idx);

    const [x1, y1, w1, h1] = boxes[idx];

    for (let j = i + 1; j < indices.length; j++) {
      const nextIdx = indices[j];
      if (!active[nextIdx]) continue;

      const [x2, y2, w2, h2] = boxes[nextIdx];
      const iou = calculateIoU(x1, y1, w1, h1, x2, y2, w2, h2);
      if (iou > iouThreshold) {
        active[nextIdx] = false;
      }
    }
  }

  return selected;
}

function calculateIoU(x1, y1, w1, h1, x2, y2, w2, h2) {
  const xi1 = Math.max(x1, x2);
  const yi1 = Math.max(y1, y2);
  const xi2 = Math.min(x1 + w1, x2 + w2);
  const yi2 = Math.min(y1 + h1, y2 + h2);

  const interArea = Math.max(0, xi2 - xi1) * Math.max(0, yi2 - yi1);
  const area1 = w1 * h1;
  const area2 = w2 * h2;

  return interArea / (area1 + area2 - interArea + 1e-6);
}

/**
 * Temporal Smoothing: Only count a detection if the same object class is seen in at least 3 of the last 5 frames
 */
function applyTemporalSmoothing(currentFrameDetections) {
  const currentClasses = new Set(currentFrameDetections.map(d => d.class.toLowerCase()));
  state.recentFramesHistory.push(currentClasses);

  if (state.recentFramesHistory.length > 5) {
    state.recentFramesHistory.shift();
  }

  // Filter current detections
  return currentFrameDetections.filter(det => {
    const label = det.class.toLowerCase();
    let occurrences = 0;
    for (const frameSet of state.recentFramesHistory) {
      if (frameSet.has(label)) occurrences++;
    }
    // Only count if seen in at least 3 of the last 5 frames
    return occurrences >= 3;
  });
}

/**
 * Render Bounding Boxes, HUD, and Handle Caution/Danger Alert Logic
 */
function renderDetections(detections, video, canvas, rawTopDetection = null) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  let hasPerson = false;
  let highestPersonScore = 0;
  let harmfulDetected = null;
  const currentObjectsList = [];

  const harmfulClasses = ['knife', 'scissors', 'baseball bat'];

  // If no confirmed detections exist, but we have a raw top detection, draw it as a subtle debug box
  if (detections.length === 0 && rawTopDetection && rawTopDetection.box) {
    const [rx, ry, rw, rh] = rawTopDetection.box;
    const rScore = Math.round(rawTopDetection.score * 100);
    const rLabel = (rawTopDetection.class || 'unknown').toLowerCase();

    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)'; // subtle slate/gray
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rx, ry, rw, rh);

    const debugText = `[RAW TOP] ${rLabel} ${rScore}%`;
    ctx.font = '10px monospace';
    const textWidth = ctx.measureText(debugText).width;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.fillRect(rx, ry > 16 ? ry - 16 : ry, textWidth + 8, 16);
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(debugText, rx + 4, (ry > 16 ? ry - 16 : ry) + 12);
    ctx.restore();
  }

  detections.forEach(det => {
    const [x, y, width, height] = det.box;
    const score = Math.round(det.score * 100);
    const label = det.class.toLowerCase();

    currentObjectsList.push({ label, score });

    const isPerson = label === 'person';
    const isHarmful = harmfulClasses.includes(label);

    if (isPerson && det.score >= 0.60) {
      hasPerson = true;
      if (det.score > highestPersonScore) highestPersonScore = det.score;
    }

    if (isHarmful && det.score >= 0.45) {
      if (!harmfulDetected || det.score > harmfulDetected.score) {
        harmfulDetected = { name: label, score: det.score };
      }
    }

    // Styling
    let strokeColor = '#10b981';
    let bgColor = 'rgba(16, 185, 129, 0.85)';

    if (isHarmful) {
      strokeColor = '#ef4444';
      bgColor = 'rgba(239, 68, 68, 0.9)';
    } else if (isPerson) {
      strokeColor = '#f59e0b';
      bgColor = 'rgba(245, 158, 11, 0.9)';
    }

    // Bounding Box
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = isHarmful ? 4 : 3;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 6);
    ctx.stroke();

    // Label Tag
    const tagText = `${isHarmful ? '⚠️ ' : ''}${label.toUpperCase()} ${score}%`;
    ctx.font = 'bold 12px "Plus Jakarta Sans", sans-serif';
    const textWidth = ctx.measureText(tagText).width;
    const tagHeight = 20;

    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.roundRect(x, y - tagHeight > 0 ? y - tagHeight : y, textWidth + 12, tagHeight, [4, 4, 0, 0]);
    ctx.fill();

    ctx.fillStyle = isPerson && !isHarmful ? '#0f172a' : '#ffffff';
    ctx.fillText(tagText, x + 6, (y - tagHeight > 0 ? y - tagHeight : y) + 14);
  });

  // Update HUD
  const hudStatus = document.getElementById('hudPersonStatus');
  const hudDot = document.getElementById('cameraHudDot');
  if (hudStatus && hudDot) {
    if (harmfulDetected) {
      hudStatus.textContent = `DANGER: ${harmfulDetected.name.toUpperCase()} (${Math.round(harmfulDetected.score * 100)}%)`;
      hudDot.className = 'w-2 h-2 rounded-full bg-rose-500 animate-ping';
    } else if (hasPerson) {
      hudStatus.textContent = `Caution: Person Confirmed (${Math.round(highestPersonScore * 100)}%)`;
      hudDot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-ping';
    } else {
      hudStatus.textContent = detections.length > 0 ? `${detections.length} Object(s) in View` : 'Clear • No Threat';
      hudDot.className = 'w-2 h-2 rounded-full bg-emerald-400';
    }
  }

  // Update Live Objects Pill List
  updateDetectedObjectsList(currentObjectsList);

  // EVALUATE ALERT RULES:
  if (harmfulDetected) {
    state.lastHarmfulObjectSeenTime = Date.now();
    onDangerHarmfulAlert(harmfulDetected.name, harmfulDetected.score, false); // Layer 1 confirm
  } else {
    // If continuous alarm is active, check if 10 seconds have elapsed with no harmful object
    if (state.isContinuousAlarmActive) {
      const elapsedSinceHarmful = Date.now() - state.lastHarmfulObjectSeenTime;
      if (elapsedSinceHarmful >= 10000) {
        console.log('No harmful object seen for 10 seconds. Auto-silencing danger alarm.');
        silenceContinuousAlarm();
      }
    }

    if (hasPerson) {
      // Trigger Caution alert
      onCautionPersonAlert(highestPersonScore);
    }
  }
}

// Default model & Fallback sequence for 503 / 404 resilience
const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';
const GEMINI_FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash'];

// Helper to delay execution
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * LAYER 2: Discovery of Available Gemini Models
 * Queries GET https://generativelanguage.googleapis.com/v1beta/models?key=<API_KEY>
 * Picks the best flash model that supports generateContent.
 * Returns the short model ID (no "models/" prefix).
 */
async function discoverGeminiModels(apiKey) {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!res.ok) {
      let errBody = '';
      try { const ej = await res.json(); errBody = ej.error ? ej.error.message : JSON.stringify(ej); }
      catch (e) { errBody = res.statusText; }
      throw new Error(`HTTP ${res.status}: ${errBody}`);
    }

    const data = await res.json();
    const models = data.models || [];
    state.geminiAvailableModelsList = models.map(m => m.name.replace(/^models\//, ''));

    // Only keep models that support generateContent
    const contentModels = models.filter(m =>
      Array.isArray(m.supportedGenerationMethods) &&
      m.supportedGenerationMethods.includes('generateContent')
    );

    let chosenModel = '';
    if (state.geminiModelOverride) {
      // User override always wins
      chosenModel = state.geminiModelOverride.replace(/^models\//, '');
    } else {
      // Pick first model whose name contains "flash" and whose supportedGenerationMethods includes "generateContent"
      const firstFlash = contentModels.find(m => m.name.toLowerCase().includes('flash'));
      if (firstFlash) {
        chosenModel = firstFlash.name.replace(/^models\//, '');
      } else if (contentModels.length > 0) {
        chosenModel = contentModels[0].name.replace(/^models\//, '');
      }
    }

    state.geminiResolvedModel = chosenModel || GEMINI_DEFAULT_MODEL;
    console.log(`Gemini model discovered → ${state.geminiResolvedModel}`);
    updateDebugGeminiDisplay(state.geminiResolvedModel, state.geminiAvailableModelsList);
    return state.geminiResolvedModel;

  } catch (err) {
    console.error('Failed to discover Gemini models:', err);
    updateDebugGeminiDisplay(`Discovery error: ${err.message}`, []);
    // Keep existing resolved model if we have one, otherwise fall back to default
    state.geminiResolvedModel = state.geminiResolvedModel || state.geminiModelOverride || GEMINI_DEFAULT_MODEL;
    return state.geminiResolvedModel;
  }
}

function updateDebugGeminiDisplay(activeModel, modelList) {
  const modelNameEl = document.getElementById('debugGeminiModelName');
  const availableListEl = document.getElementById('debugGeminiAvailableModels');

  if (modelNameEl) {
    modelNameEl.textContent = activeModel;
  }
  if (availableListEl) {
    if (modelList && modelList.length > 0) {
      availableListEl.textContent = `Available: ${modelList.slice(0, 5).join(', ')}${modelList.length > 5 ? '...' : ''}`;
      availableListEl.title = modelList.join(', ');
    } else {
      availableListEl.textContent = activeModel.startsWith('Error') ? activeModel : 'No models list available';
    }
  }
}

/**
 * LAYER 2: Independent Vision AI Check via Gemini API
 * Runs periodically (every 5s) while camera is on, independent of Layer 1
 * Concurrency guard: Ensures no two Gemini calls ever run at the same time.
 */
async function triggerLayer2VisionAiCheck(video) {
  const now = Date.now();

  // If Gemini is paused (e.g. after all models failed), show temporary notice and skip
  if (now < state.geminiPausedUntil) {
    const remainingSec = Math.ceil((state.geminiPausedUntil - now) / 1000);
    const indicator = document.getElementById('visionAiStatusIndicator');
    if (indicator) {
      indicator.innerHTML = `<span class="text-amber-500 font-medium" title="Paused for ${remainingSec}s">AI check temporarily unavailable (${remainingSec}s)</span>`;
    }
    return;
  }

  // Enforce single caller concurrency guard & 5s interval
  if (now - state.lastVisionAiCheckTime < 5000 || state.isVisionAiRunning) {
    return;
  }

  state.lastVisionAiCheckTime = now;
  state.isVisionAiRunning = true;

  const indicator = document.getElementById('visionAiStatusIndicator');
  if (indicator) {
    indicator.innerHTML = '<span class="text-indigo-400 animate-pulse flex items-center gap-1"><i data-lucide="loader-2" class="w-3 h-3 animate-spin"></i>Checking frame...</span>';
    if (window.lucide) lucide.createIcons();
  }

  try {
    const apiKey = state.geminiApiKey || (typeof process !== 'undefined' && process.env && process.env.GEMINI_API_KEY) || '';
    if (!apiKey) {
      if (indicator) indicator.innerHTML = '<span class="text-slate-400">Layer 1 only (Add Key in Settings)</span>';
      state.isVisionAiRunning = false;
      return;
    }

    const snapshotBase64 = captureSnapshotBase64(video, 640);
    const result = await callGeminiVisionApi(apiKey, snapshotBase64);

    console.log('Layer 2 Vision AI result:', result);

    // Rule 1: Dangerous object confirmed by AI
    if (result.harmful === true && result.confidence >= 60) {
      state.lastHarmfulObjectSeenTime = Date.now();
      if (indicator) {
        indicator.innerHTML = `<span class="text-rose-500 font-bold flex items-center gap-1"><i data-lucide="shield-alert" class="w-3 h-3"></i>Dangerous: ${result.object}</span>`;
      }
      onDangerHarmfulAlert(result.object || 'Harmful Object', result.confidence / 100, true);
    } 
    // Rule 2: Person detected with no harmful object -> Trigger Caution as before
    else if (result.person === true || (result.object && result.object.toLowerCase().includes('person'))) {
      if (indicator) {
        indicator.innerHTML = '<span class="text-amber-400 flex items-center gap-1"><i data-lucide="user" class="w-3 h-3"></i>Person visible (Clear)</span>';
      }
      onCautionPersonAlert(result.confidence ? result.confidence / 100 : 0.85);
    } else {
      if (indicator) {
        indicator.innerHTML = '<span class="text-emerald-500 flex items-center gap-1"><i data-lucide="check" class="w-3 h-3"></i>No threat</span>';
      }
    }

  } catch (err) {
    console.warn('Layer 2 Vision AI call failed. Falling back to Layer 1 only:', err);
    
    // Check if error is due to all models failing / pause triggered
    if (Date.now() < state.geminiPausedUntil) {
      if (indicator) {
        indicator.innerHTML = `<span class="text-amber-500 font-semibold" title="${err.message}">AI check temporarily unavailable</span>`;
      }
    } else if (indicator) {
      indicator.innerHTML = `<span class="text-amber-500" title="${err.message}">AI check unavailable: ${err.message.slice(0, 40)}</span>`;
    }

    // Also display in debug panel
    const rawBox = document.getElementById('debugAiRawOutput');
    if (rawBox) {
      rawBox.classList.remove('hidden');
      rawBox.innerHTML = `<span class="text-rose-400"><strong>AI Error:</strong> ${err.message}</span>`;
    }
  } finally {
    state.isVisionAiRunning = false;
    if (window.lucide) lucide.createIcons();
  }
}

/**
 * Common Gemini Vision API Call with 503 & 404 Resilience:
 * 1. Checks 503 (UNAVAILABLE) on primary model: retries after 2s, then after 5s (max 2 retries).
 * 2. If primary model still fails, cascades through GEMINI_FALLBACK_MODELS:
 *    [gemini-3.5-flash-lite, gemini-3.5-flash, gemini-3.8-flash].
 * 3. Skips any model that returns 404 (NOT_FOUND).
 * 4. Remembers the last working model in state & localStorage ('geminiLastWorkingModel').
 * 5. If all fail, pauses Gemini for 30s, shows "AI check temporarily unavailable", keeping YOLO active.
 * 6. Never allows two calls to run concurrently.
 */
async function callGeminiVisionApi(apiKey, snapshotBase64) {
  // If no resolved model yet, check last working model or discover
  if (!state.geminiResolvedModel) {
    state.geminiResolvedModel = localStorage.getItem('geminiLastWorkingModel') || await discoverGeminiModels(apiKey);
  }

  // Determine starting model (respect settings override first)
  const startingModel = (state.geminiModelOverride || state.geminiResolvedModel || GEMINI_DEFAULT_MODEL)
    .replace(/^models\//, '');

  // Build the list of models to try: startingModel first, then the remaining fallbacks
  const modelsToTry = [startingModel];
  for (const m of GEMINI_FALLBACK_MODELS) {
    if (!modelsToTry.includes(m)) {
      modelsToTry.push(m);
    }
  }

  let lastError = null;

  for (let modelIdx = 0; modelIdx < modelsToTry.length; modelIdx++) {
    const currentModel = modelsToTry[modelIdx];

    // Try current model with up to 2 retries on 503 (immediate, after 2s, after 5s)
    const retryDelays = [0, 2000, 5000]; // attempt 0: immediate, attempt 1: wait 2s, attempt 2: wait 5s

    for (let attempt = 0; attempt < retryDelays.length; attempt++) {
      if (attempt > 0) {
        const delaySec = retryDelays[attempt] / 1000;
        const retryMsg = `503 on ${currentModel}, retrying in ${delaySec}s (attempt ${attempt}/2)...`;
        console.warn(retryMsg);
        updateDebugGeminiDisplay(`${currentModel} (${retryMsg})`, state.geminiAvailableModelsList);
        await sleep(retryDelays[attempt]);
      } else {
        updateDebugGeminiDisplay(currentModel, state.geminiAvailableModelsList);
      }

      try {
        const result = await _executeGeminiRequest(apiKey, currentModel, snapshotBase64);

        // SUCCESS! Remember this model as the last working model
        console.log(`Gemini call succeeded on model: ${currentModel}`);
        state.geminiResolvedModel = currentModel;
        localStorage.setItem('geminiLastWorkingModel', currentModel);
        updateDebugGeminiDisplay(currentModel, state.geminiAvailableModelsList);
        return result;

      } catch (err) {
        lastError = err;
        const is503 = err.status === 503 || err.message.includes('503') || err.message.includes('UNAVAILABLE');
        const is404 = err.status === 404 || err.message.includes('404') || err.message.includes('NOT_FOUND');

        // If 404, immediately skip this model (do not retry 404s)
        if (is404) {
          console.warn(`Model ${currentModel} returned 404/NOT_FOUND. Skipping immediately.`);
          break; // break retry loop to move to next fallback model
        }

        // If 503, retry up to 2 times
        if (is503) {
          if (attempt < retryDelays.length - 1) {
            // will continue to next attempt in this retry loop
            continue;
          } else {
            console.warn(`Model ${currentModel} failed after 2 retries on 503.`);
            // check if there is a next model in modelsToTry
            const nextModel = modelsToTry[modelIdx + 1];
            if (nextModel) {
              const switchMsg = `503 on ${currentModel}, retrying with ${nextModel}`;
              console.warn(switchMsg);
              updateDebugGeminiDisplay(switchMsg, state.geminiAvailableModelsList);
            }
            break; // break retry loop to switch to next fallback model
          }
        }

        // Other non-503, non-404 error (e.g. invalid API key 400/403)
        throw err;
      }
    }
  }

  // If we reach here, all fallback models failed
  console.error('All Gemini fallback models failed. Pausing Gemini for 30 seconds.');
  state.geminiPausedUntil = Date.now() + 30000; // Pause for 30 seconds

  const indicator = document.getElementById('visionAiStatusIndicator');
  if (indicator) {
    indicator.innerHTML = '<span class="text-amber-500 font-semibold">AI check temporarily unavailable</span>';
  }

  updateDebugGeminiDisplay('Paused (All models failed, retrying in 30s)', state.geminiAvailableModelsList);

  throw new Error(`All Gemini models failed. AI check paused for 30s. Last error: ${lastError ? lastError.message : 'Unknown'}`);
}

/**
 * Low-level HTTP POST to generateContent endpoint for a specific model
 */
async function _executeGeminiRequest(apiKey, modelName, snapshotBase64) {
  const prompt = 'Analyze this image. Is there a person present? Is any person holding or carrying any dangerous object, such as a knife, screwdriver, hammer, scissors, bat, gun or similar? Answer ONLY with JSON: {"person": true/false, "harmful": true/false, "object": "name or none", "confidence": 0-100}';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            { inline_data: { mime_type: 'image/jpeg', data: snapshotBase64 } }
          ]
        }
      ],
      generationConfig: { response_mime_type: 'application/json', temperature: 0.1 }
    })
  });

  if (!response.ok) {
    let fullErrorMessage = '';
    let apiStatus = '';
    try {
      const errJson = await response.json();
      fullErrorMessage = errJson.error
        ? `${errJson.error.message} (Code: ${errJson.error.code}, Status: ${errJson.error.status})`
        : JSON.stringify(errJson);
      apiStatus = errJson.error?.status || '';
    } catch (e) {
      fullErrorMessage = await response.text();
    }

    const err = new Error(`HTTP ${response.status} on model '${modelName}': ${fullErrorMessage || response.statusText}`);
    err.status = response.status;
    err.apiStatus = apiStatus;
    throw err;
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini API (no candidates text)');

  // Strip markdown code fences in case Gemini wraps its answer
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (parseErr) {
    throw new Error(`Gemini response not valid JSON: ${cleaned.slice(0, 200)}`);
  }
}

/**
 * Manual "Test AI check" button: queries models, sends current frame, and displays full response or error
 */
async function testGeminiVisionAi() {
  const video = document.getElementById('webcamVideo');
  const rawBox = document.getElementById('debugAiRawOutput');
  const btn = document.getElementById('testVisionAiBtn');

  if (!state.cameraActive || !video || video.readyState < 2) {
    alert('Please start the camera first before running the AI test.');
    return;
  }

  const apiKey = state.geminiApiKey || '';
  if (!apiKey) {
    alert('Please enter and save your Gemini API Key in Settings first.');
    openSettingsModal();
    return;
  }

  if (rawBox) {
    rawBox.classList.remove('hidden');
    rawBox.innerHTML = '<span class="text-indigo-400 animate-pulse">Querying Gemini models and analyzing current frame...</span>';
  }
  if (btn) btn.disabled = true;

  try {
    // 1. Refresh available models list first
    await discoverGeminiModels(apiKey);

    // 2. Capture frame and call Vision API
    const snapshotBase64 = captureSnapshotBase64(video, 640);
    const result = await callGeminiVisionApi(apiKey, snapshotBase64);

    if (rawBox) {
      rawBox.innerHTML = `<span class="text-emerald-400"><strong>Success (${state.geminiResolvedModel}):</strong></span> <pre class="mt-0.5 text-[9.5px]">${JSON.stringify(result, null, 2)}</pre>`;
    }
    console.log('Manual AI check raw result:', result);

    if (result.harmful === true && result.confidence >= 60) {
      onDangerHarmfulAlert(result.object || 'Harmful Object', result.confidence / 100, true);
    } else if (result.person === true) {
      onCautionPersonAlert(result.confidence ? result.confidence / 100 : 0.85);
    }
  } catch (err) {
    console.error('Manual AI check error:', err);
    if (rawBox) {
      rawBox.innerHTML = `<span class="text-rose-400 font-bold">❌ Error:</span> <span class="text-rose-300 break-words">${err.message}</span>`;
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

/**
 * Capture video frame as base64 JPEG (scaled to ~640px wide)
 */
function captureSnapshotBase64(video, targetWidth = 640) {
  const canvas = document.createElement('canvas');
  const aspectRatio = video.videoHeight / (video.videoWidth || 1);
  canvas.width = targetWidth;
  canvas.height = Math.round(targetWidth * aspectRatio);

  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return dataUrl.split(',')[1];
}

function updateDetectedObjectsList(objects) {
  const countEl = document.getElementById('detectedObjectsCount');
  const listEl = document.getElementById('detectedObjectsList');
  if (!listEl) return;

  if (countEl) countEl.textContent = objects.length;

  if (objects.length === 0) {
    listEl.innerHTML = '<span class="text-[11px] text-slate-400 italic">None detected</span>';
    return;
  }

  const harmfulClasses = ['knife', 'scissors', 'baseball bat'];

  listEl.innerHTML = objects.map(item => {
    const isHarmful = harmfulClasses.includes(item.label.toLowerCase());
    const isPerson = item.label.toLowerCase() === 'person';

    let pillClass = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800';
    if (isHarmful) {
      pillClass = 'bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-200 border-rose-400 dark:border-rose-700 font-bold animate-pulse';
    } else if (isPerson) {
      pillClass = 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border-amber-300 dark:border-amber-700';
    }

    return `
      <span class="px-2 py-0.5 rounded-md text-[11px] font-semibold border ${pillClass} flex items-center gap-1">
        <span>${isHarmful ? '⚠️ ' : ''}${item.label}</span>
        <span class="opacity-75 font-mono text-[10px]">${item.score}%</span>
      </span>
    `;
  }).join('');
}

/**
 * CAUTION Level Alert: Person detected (confidence > 60%) and no harmful object
 */
async function onCautionPersonAlert(score) {
  const now = Date.now();
  const cooldownMs = 10000; // 10 seconds cooldown

  if (now - state.lastPersonAlertTime < cooldownMs) {
    return; // Cooldown active
  }
  state.lastPersonAlertTime = now;

  const scorePct = Math.round(score * 100);

  // 1. Show Yellow Caution banner
  triggerAlertBanner(`Caution: Person detected (${scorePct}% confidence)`, 'caution');

  // 2. Follow "Person alert sound" setting: 'none' (alert only), 'device', 'laptop'
  await dispatchPersonAlertSound();

  // 3. Add to Recent alerts table: Severity = Caution, Source = Camera
  const distText = (state.currentDist && state.currentDist !== 999) ? `${state.currentDist} cm` : 'In View';
  const newAlert = {
    id: Date.now(),
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    severity: 'Caution',
    type: 'Person Detected',
    source: 'Camera',
    details: `Person detected (${scorePct}% confidence)`,
    distance: distText,
    status: 'Warning',
    aiCheck: 'none',
    aiChecked: false,
    ts: now
  };
  state.alerts.unshift(newAlert);
  renderAlertsTable(state.alerts);

  // Save to Cloud Firestore
  saveAlertToFirestore(newAlert);

  // 4. Update Stats counters & Charts
  state.stats.alertsToday += 1;
  state.stats.objectsDetected += 1;
  updateStatsDisplay();

  if (chartAlertsByType) {
    chartAlertsByType.data.datasets[0].data[1] += 1;
    chartAlertsByType.update();
  }
  const donutTotal = document.getElementById('donutTotalCount');
  const donutPerson = document.getElementById('donutCountPerson');
  if (donutTotal) donutTotal.textContent = state.stats.alertsToday;
  if (donutPerson) donutPerson.textContent = parseInt(donutPerson.textContent || 0) + 1;
}

/**
 * Handles Person Alert Sound based on setting
 */
async function dispatchPersonAlertSound() {
  const soundMode = state.personAlertSound; // 'none', 'device', 'laptop'
  if (soundMode === 'device') {
    await writeSerialCommand('BUZZ\n');
  } else if (soundMode === 'laptop') {
    playLocalBeep();
  }
}

/**
 * DANGER Level Alert: Harmful object confirmed by Layer 1 (YOLO11) or Layer 2 (Vision AI)
 */
async function onDangerHarmfulAlert(objectName, score, isFromVisionAi = false) {
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // 1. Show Large Red Banner with Silence Button
  triggerAlertBanner(`DANGER: Harmful object detected: ${objectName.toUpperCase()} at ${timeStr}`, 'danger');
  const silenceBtn = document.getElementById('silenceAlarmBtn');
  if (silenceBtn) silenceBtn.classList.remove('hidden');

  // 2. If continuous alarm is not already running, initiate it!
  if (!state.isContinuousAlarmActive) {
    startContinuousDangerAlarm();

    // 3. Add to Recent alerts table: Severity = Danger, Source = Camera
    const distText = (state.currentDist && state.currentDist !== 999) ? `${state.currentDist} cm` : 'In View';
    const newAlert = {
      id: Date.now(),
      time: timeStr,
      severity: 'Danger',
      type: `Harmful Object: ${objectName.toUpperCase()}`,
      source: 'Camera',
      details: `Detected weapon/harmful object: ${objectName.toUpperCase()} (score: ${Math.round(score * 100)}%)`,
      distance: distText,
      status: 'Critical',
      aiCheck: isFromVisionAi ? 'confirmed' : 'none',
      aiChecked: Boolean(isFromVisionAi),
      ts: Date.now()
    };
    state.alerts.unshift(newAlert);
    renderAlertsTable(state.alerts);

    // Save to Cloud Firestore
    saveAlertToFirestore(newAlert);

    // 4. Update stats & charts
    state.stats.alertsToday += 1;
    state.stats.objectsDetected += 1;
    updateStatsDisplay();

    if (chartAlertsByType) {
      chartAlertsByType.data.datasets[0].data[1] += 1;
      chartAlertsByType.update();
    }
    const donutTotal = document.getElementById('donutTotalCount');
    if (donutTotal) donutTotal.textContent = state.stats.alertsToday;
  }
}

/**
 * Starts continuous alarm on BOTH the device buzzer (BUZZ\n every 1 sec) and laptop sound
 * Ignores "Person alert sound" and "Alarm output" settings!
 * Sends BUZZ\n via writeSerialCommand() so retry & debug logging are unified.
 */
function startContinuousDangerAlarm() {
  state.isContinuousAlarmActive = true;
  state.lastHarmfulObjectSeenTime = Date.now();

  // A. Device: send BUZZ\n immediately, then every 1 second
  writeSerialCommand('BUZZ\n').catch(err => {
    console.warn('Initial danger buzz error:', err);
  });

  if (state.continuousAlarmInterval) clearInterval(state.continuousAlarmInterval);
  state.continuousAlarmInterval = setInterval(() => {
    if (!state.isContinuousAlarmActive) return;
    writeSerialCommand('BUZZ\n').catch(err => {
      console.warn('Interval danger buzz error:', err);
    });
  }, 1000);

  // B. Laptop: Continuous looping warble alarm sound
  startLaptopContinuousSound();
}

function startLaptopContinuousSound() {
  try {
    if (state.continuousAudioLoopCtx) return; // already active
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(800, audioCtx.currentTime);

    // Warble LFO modulation
    const lfo = audioCtx.createOscillator();
    const lfoGain = audioCtx.createGain();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(4, audioCtx.currentTime); // 4Hz siren cycle
    lfoGain.gain.setValueAtTime(250, audioCtx.currentTime);
    lfo.connect(osc.frequency);
    lfo.start();

    gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();

    state.continuousAudioLoopCtx = audioCtx;
    state.continuousAudioOsc = osc;
    state.continuousAudioGain = gain;
  } catch (e) {
    console.log('Continuous alarm audio start error:', e);
  }
}

function silenceContinuousAlarm() {
  state.isContinuousAlarmActive = false;
  state.lastAlarmSoundEndTime = Date.now();

  // Clear serial 1-sec loop
  if (state.continuousAlarmInterval) {
    clearInterval(state.continuousAlarmInterval);
    state.continuousAlarmInterval = null;
  }

  // Stop laptop continuous audio
  try {
    if (state.continuousAudioLoopCtx) {
      if (state.continuousAudioOsc) {
        state.continuousAudioOsc.stop();
        state.continuousAudioOsc.disconnect();
      }
      state.continuousAudioLoopCtx.close();
      state.continuousAudioLoopCtx = null;
      state.continuousAudioOsc = null;
      state.continuousAudioGain = null;
    }
  } catch (e) {
    console.log('Error stopping continuous audio:', e);
  }

  // Hide Silence button
  const silenceBtn = document.getElementById('silenceAlarmBtn');
  if (silenceBtn) silenceBtn.classList.add('hidden');

  triggerAlertBanner('Alarm silenced.', 'caution');
  setTimeout(() => dismissAlertBanner(), 2500);
}

/* ========================================================
   STEP 4: MICROPHONE SOUND DETECTION (WEB AUDIO & YAMNET)
======================================================== */

// Global Audio Sensor State & Objects
let micStream = null;
let micAudioContext = null;
let micAnalyser = null;
let micSource = null;
let micScriptProcessor = null;
let micLevelIntervalId = null;
let yamnetClassifyIntervalId = null;
let yamnetModel = null;
let isYamnetModelLoading = false;
let yamnetClassMap = null; // Array of 521 class display names

// Rolling audio sample ring buffer for 16 kHz mono (15600 samples ~ 0.975 sec)
const YAMNET_SAMPLE_RATE = 16000;
const YAMNET_WINDOW_SIZE = 15600; // Expected window chunk
const audioSampleRingBuffer = new Float32Array(YAMNET_WINDOW_SIZE);
let ringBufferWriteIndex = 0;
let totalSamplesRecorded = 0;

// High-priority sound categories for DANGER alert:
// Glass, Shatter, Breaking, Smash/crash, Gunshot/gunfire, Explosion, Screaming, Siren/Alarm
const DANGER_SOUND_KEYWORDS = [
  'glass', 'shatter', 'breaking', 'smash', 'crash',
  'gunshot', 'gunfire', 'explosion', 'screaming', 'siren', 'alarm'
];

// Classes to ignore so normal speech/singing/music does not trigger anything
const IGNORE_SOUND_KEYWORDS = [
  'speech', 'speaking', 'conversation', 'narration', 'music', 'singing', 'whispering', 'babbling'
];

// Classes that resemble buzzer/alarm and must be ignored within 3 seconds of any BUZZ sent
const BUZZER_FEEDBACK_SOUNDS = [
  'buzzer', 'beep', 'alarm clock', 'smoke detector', 'fire alarm', 'siren'
];

/**
 * Checks if self-noise suppression is currently active.
 * True while any alarm is sounding (BUZZ sent, PIR beep, Test buzzer, laptop alarm),
 * and for 2 seconds after the last one ends.
 */
function isSelfNoiseActive() {
  if (state.isContinuousAlarmActive) return true;
  const now = Date.now();
  if (state.lastAlarmSoundEndTime > 0 && (now - state.lastAlarmSoundEndTime) < 2000) {
    return true;
  }
  return false;
}

/**
 * Returns current sensitivity thresholds based on setting
 * Low:    Confidence >= 50%, Loudness jump >= 30 dB
 * Medium: Confidence >= 40%, Loudness jump >= 25 dB
 * High:   Confidence >= 30%, Loudness jump >= 20 dB
 */
function getSensitivityThresholds() {
  const sens = state.micSensitivity || 'medium';
  if (sens === 'low') {
    return { minConfidence: 0.50, minDbJump: 30 };
  } else if (sens === 'high') {
    return { minConfidence: 0.30, minDbJump: 20 };
  }
  return { minConfidence: 0.40, minDbJump: 25 }; // Default Medium
}

/**
 * Toggle Microphone (Start / Stop)
 */
async function toggleMicrophone() {
  if (state.micActive || state.micStopping) {
    await stopMicrophone();
  } else {
    await startMicrophone();
  }
}

/**
 * Start Microphone Feed & Audio Processing
 */
async function startMicrophone() {
  const btnText = document.getElementById('micBtnText');
  const btn = document.getElementById('toggleMicBtn');
  const badge = document.getElementById('micStatusBadge');
  const errorBox = document.getElementById('micErrorBox');
  const errorMsg = document.getElementById('micErrorMsg');

  if (errorBox) errorBox.classList.add('hidden');

  // Reset stopping flag and baseline
  state.micStopping = false;
  state.backgroundDbLevel = null;
  state.currentDbLevel = null;
  state.micStartTime = Date.now();
  audioSampleRingBuffer.fill(0);
  ringBufferWriteIndex = 0;
  totalSamplesRecorded = 0;

  try {
    // 1. Request microphone access with all hardware processing explicitly OFF
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1
      },
      video: false
    });

    // 2. Initialize Web Audio Context at native sample rate or 16000Hz
    micAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    const inputSampleRate = micAudioContext.sampleRate;
    console.log(`Microphone stream opened. Hardware sample rate: ${inputSampleRate} Hz`);

    // Analyser Node for live volume (dB) calculation and frequency rendering
    micAnalyser = micAudioContext.createAnalyser();
    micAnalyser.fftSize = 512;
    micAnalyser.smoothingTimeConstant = 0.3;

    micSource = micAudioContext.createMediaStreamSource(micStream);
    micSource.connect(micAnalyser);

    // Audio Worklet / ScriptProcessor Node to resample to 16 kHz mono for YAMNet
    // Buffer size of 4096 gives ~85ms chunks at 48kHz
    micScriptProcessor = micAudioContext.createScriptProcessor(4096, 1, 1);
    micAnalyser.connect(micScriptProcessor);
    // Connect to destination via silent gain to keep audio pipeline active in Chrome
    const silentGain = micAudioContext.createGain();
    silentGain.gain.value = 0;
    micScriptProcessor.connect(silentGain);
    silentGain.connect(micAudioContext.destination);

    // Stream handler: resample and push into ring buffer
    micScriptProcessor.onaudioprocess = (e) => {
      if (!state.micActive || state.micStopping) return;
      const inputBuffer = e.inputBuffer.getChannelData(0);
      resampleAndFeedRingBuffer(inputBuffer, inputSampleRate, YAMNET_SAMPLE_RATE);
    };

    state.micActive = true;
    updateMicDeviceStatus(true);

    if (btnText) btnText.textContent = 'Stop Mic';
    if (btn) btn.className = 'px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition active:scale-95 flex items-center gap-1.5';
    if (badge) {
      badge.textContent = 'Live (YAMNet)';
      badge.className = 'text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400';
    }

    // 3. Start Live Sound Level Meter (runs ~10 times per sec = 100ms)
    startSoundLevelMeter();

    // 4. Load YAMNet Model & Class Map in background if not already loaded
    if (!yamnetModel && !isYamnetModelLoading) {
      loadYamnetModelAndClassMap();
    }

    // 5. Start YAMNet Sound Classification Loop (every 0.5 sec = 500ms)
    if (yamnetClassifyIntervalId) clearInterval(yamnetClassifyIntervalId);
    yamnetClassifyIntervalId = setInterval(runYamnetClassification, 500);

    triggerAlertBanner('🎤 Microphone active! Real-time sound analysis & YAMNet running.', 'caution');
    setTimeout(() => dismissAlertBanner(), 3000);

  } catch (err) {
    console.error('Microphone access failed:', err);
    state.micActive = false;
    state.micStopping = false;
    updateMicDeviceStatus(false);

    if (errorBox) {
      errorBox.classList.remove('hidden');
      if (errorMsg) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          errorMsg.textContent = 'Microphone permission was denied in your browser settings.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          errorMsg.textContent = 'No microphone device was found on this laptop.';
        } else {
          errorMsg.textContent = `Microphone error: ${err.message || 'Access failed'}`;
        }
      }
    }

    if (btnText) btnText.textContent = 'Start Mic';
    if (btn) btn.className = 'px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs transition active:scale-95 flex items-center gap-1.5';
    if (badge) {
      badge.textContent = 'Mic Off';
      badge.className = 'text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
    }
  }

  if (window.lucide) lucide.createIcons();
}

/**
 * Stop Microphone and clean up Web Audio graph cleanly
 * Strict execution order:
 * 1. Set micStopping = true immediately (blocks any further audio/classification alerts)
 * 2. Clear audio analysis and YAMNet timers first
 * 3. Stop media stream tracks second
 * 4. Close AudioContext third
 * 5. Discard last 1 second of buffer (fill with 0) to avoid classifying the stop-button click
 * 6. If continuous alarm from microphone is active, silence it immediately
 * 7. Reset baseline and UI
 */
async function stopMicrophone() {
  // Step 1: Immediately set stopping guard flag
  state.micStopping = true;
  state.micActive = false;
  updateMicDeviceStatus(false);

  // Step 2: Stop timers first
  if (micLevelIntervalId) {
    clearInterval(micLevelIntervalId);
    micLevelIntervalId = null;
  }

  if (yamnetClassifyIntervalId) {
    clearInterval(yamnetClassifyIntervalId);
    yamnetClassifyIntervalId = null;
  }

  // Step 3: Discard the final buffered window of audio so click sound is never processed
  audioSampleRingBuffer.fill(0);
  ringBufferWriteIndex = 0;
  totalSamplesRecorded = 0;

  // Step 4: Stop media stream tracks second
  if (micStream) {
    micStream.getTracks().forEach(track => {
      try { track.stop(); } catch (e) {}
    });
    micStream = null;
  }

  // Step 5: Disconnect nodes and close AudioContext third
  if (micScriptProcessor) {
    try { micScriptProcessor.disconnect(); } catch (e) {}
    micScriptProcessor = null;
  }

  if (micSource) {
    try { micSource.disconnect(); } catch (e) {}
    micSource = null;
  }

  if (micAnalyser) {
    try { micAnalyser.disconnect(); } catch (e) {}
    micAnalyser = null;
  }

  if (micAudioContext && micAudioContext.state !== 'closed') {
    try { await micAudioContext.close(); } catch (e) {}
    micAudioContext = null;
  }

  // Step 6: If a continuous alarm originated from microphone, silence it immediately
  if (state.isContinuousAlarmActive) {
    const isMicAlertActive = state.alerts.length > 0 && state.alerts[0].source === 'Microphone';
    if (isMicAlertActive) {
      console.log('Stopping continuous alarm triggered by microphone.');
      silenceContinuousAlarm();
    }
  }

  // Step 7: Reset baseline to nothing
  state.backgroundDbLevel = null;
  state.currentDbLevel = null;
  recentDbHistory = [];

  // Update UI Elements
  const btnText = document.getElementById('micBtnText');
  const btn = document.getElementById('toggleMicBtn');
  const badge = document.getElementById('micStatusBadge');
  const soundLevel = document.getElementById('soundLevelText');
  const soundStatus = document.getElementById('soundStatusText');
  const topList = document.getElementById('topSoundsList');
  const yamStatus = document.getElementById('micYAMNetStatus');
  const debugAudio = document.getElementById('debugAudioInfo');

  if (btnText) btnText.textContent = 'Start Mic';
  if (btn) btn.className = 'px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs transition active:scale-95 flex items-center gap-1.5';
  if (badge) {
    badge.textContent = 'Mic Off';
    badge.className = 'text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
  }
  if (soundLevel) soundLevel.textContent = 'silence';
  if (soundStatus) soundStatus.textContent = 'Quiet / Normal';
  if (yamStatus) yamStatus.textContent = 'Model Idle';
  if (topList) topList.innerHTML = '<div class="text-[11px] text-slate-400 italic">Microphone inactive</div>';
  if (debugAudio) debugAudio.textContent = 'Mic Inactive • silence';

  state.micStopping = false;

  if (window.lucide) lucide.createIcons();
}

/**
 * Updates Device Status Card: "Microphone (YAMNet)" -> ACTIVE / STANDBY
 */
function updateMicDeviceStatus(isActive) {
  const dot = document.getElementById('deviceStatusMicDot');
  const text = document.getElementById('deviceStatusMicText');

  if (dot) {
    dot.className = isActive 
      ? 'w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse' 
      : 'w-2.5 h-2.5 rounded-full bg-slate-400';
  }
  if (text) {
    text.textContent = isActive ? 'ACTIVE' : 'STANDBY';
    text.className = isActive 
      ? 'font-medium text-emerald-600 dark:text-emerald-400 font-mono text-[11px]' 
      : 'font-medium text-slate-500 dark:text-slate-400 font-mono text-[11px]';
  }
}

/**
 * Linear resampler feeding mono float32 samples into the fixed 15600 ring buffer
 */
function resampleAndFeedRingBuffer(inputChannelData, fromRate, toRate) {
  if (fromRate === toRate) {
    for (let i = 0; i < inputChannelData.length; i++) {
      audioSampleRingBuffer[ringBufferWriteIndex] = inputChannelData[i];
      ringBufferWriteIndex = (ringBufferWriteIndex + 1) % YAMNET_WINDOW_SIZE;
      totalSamplesRecorded++;
    }
    return;
  }

  const ratio = fromRate / toRate;
  const outLength = Math.floor(inputChannelData.length / ratio);

  for (let i = 0; i < outLength; i++) {
    const origIndex = i * ratio;
    const indexLow = Math.floor(origIndex);
    const indexHigh = Math.min(indexLow + 1, inputChannelData.length - 1);
    const fraction = origIndex - indexLow;

    // Linear interpolation
    const sample = (1 - fraction) * inputChannelData[indexLow] + fraction * inputChannelData[indexHigh];
    audioSampleRingBuffer[ringBufferWriteIndex] = sample;
    ringBufferWriteIndex = (ringBufferWriteIndex + 1) % YAMNET_WINDOW_SIZE;
    totalSamplesRecorded++;
  }
}

// Rolling window of recent dB readings (to verify sound sustained >= 0.1s and filter instant clicks)
let recentDbHistory = [];

/**
 * Live Sound Level Meter (Updates ~10 times per sec = 100ms)
 * Computes RMS volume in dBFS and detects sudden loudness jumps (Caution alert)
 * 1. Checks micStopping / micActive to prevent any post-stop calculations or alerts.
 * 2. If silent / empty buffer (< -90 dBFS), displays "silence".
 * 3. Grace period of 2 seconds after Start: baseline builds, no alerts fired.
 * 4. Sustained duration check: ignores single-frame spikes (< 0.1s clicks).
 */
function startSoundLevelMeter() {
  if (micLevelIntervalId) clearInterval(micLevelIntervalId);

  let peakDb = -90;
  const timeData = new Float32Array(micAnalyser ? micAnalyser.fftSize : 512);
  recentDbHistory = [];

  micLevelIntervalId = setInterval(() => {
    if (!state.micActive || state.micStopping || !micAnalyser) return;

    micAnalyser.getFloatTimeDomainData(timeData);

    // Compute RMS
    let sumSquares = 0;
    for (let i = 0; i < timeData.length; i++) {
      sumSquares += timeData[i] * timeData[i];
    }

    // Never compute from empty or silent buffer
    if (sumSquares === 0 || isNaN(sumSquares)) {
      state.currentDbLevel = -95;
      updateSoundLevelUI('silence', -95, peakDb);
      return;
    }

    const rms = Math.sqrt(sumSquares / timeData.length);

    // Convert to dBFS
    let db = -95;
    if (rms > 0.000001) {
      db = Math.round(20 * Math.log10(rms));
    }

    // Level check: if below -90 dBFS, show "silence" instead of number
    const isSilence = db <= -90;
    state.currentDbLevel = isSilence ? -95 : db;

    if (!isSilence && db > peakDb) peakDb = db;

    // Track rolling history of dB samples (last 5 samples = 500ms)
    recentDbHistory.push(db);
    if (recentDbHistory.length > 5) recentDbHistory.shift();

    // Update Live Level UI
    const displayText = isSilence ? 'silence' : `${db} dBFS`;
    updateSoundLevelUI(displayText, db, peakDb);

    // Dynamic Visualizer Canvas Rendering
    drawActiveAudioVisualizer(timeData, isSilence ? -90 : db);

    // Build rolling background average level (slow adaptation)
    if (state.backgroundDbLevel === null) {
      state.backgroundDbLevel = isSilence ? -60 : db;
    } else if (!isSilence) {
      state.backgroundDbLevel = (state.backgroundDbLevel * 0.95) + (db * 0.05);
    }

    // Check 2-second warm-up grace period after start
    const elapsedSinceStart = Date.now() - state.micStartTime;
    if (elapsedSinceStart < 2000) {
      const statusEl = document.getElementById('soundStatusText');
      if (statusEl) statusEl.textContent = 'Calibrating baseline...';
      return;
    }

    // Check Self-Noise suppression flag: true while any alarm is sounding and for 2s after
    if (isSelfNoiseActive()) {
      const statusEl = document.getElementById('soundStatusText');
      if (statusEl) statusEl.textContent = 'Mic paused: alarm sounding';
      return;
    }

    // If stopping or stopped, exit without evaluating alerts
    if (state.micStopping || !state.micActive) return;

    // Evaluate CAUTION rule:
    // sudden sound jump > threshold (e.g. 25 dB) above background AND above -20 dBFS
    const { minDbJump } = getSensitivityThresholds();
    const baseline = state.backgroundDbLevel !== null ? state.backgroundDbLevel : -60;
    const jump = db - baseline;

    const statusEl = document.getElementById('soundStatusText');

    if (jump >= minDbJump && db > -20 && !isSilence) {
      // Click filter: Sound must not be a single sub-0.1s instant click
      // Verify that at least 2 consecutive frames or adjacent samples register elevated volume (> baseline + 12 dB)
      const elevatedCount = recentDbHistory.filter(val => val > (baseline + 12)).length;
      const isSub100msClick = elevatedCount <= 1;

      if (!isSub100msClick) {
        if (statusEl) statusEl.textContent = `Sudden Noise (+${Math.round(jump)} dB)`;
        onCautionLoudSoundAlert(db, Math.round(jump));
      } else {
        console.log('Ignored instantaneous impulse (<0.1s click).');
      }
    } else if (db < -45 || isSilence) {
      if (statusEl && !state.isContinuousAlarmActive) statusEl.textContent = 'Quiet / Normal';
    } else {
      if (statusEl && !state.isContinuousAlarmActive) statusEl.textContent = 'Moderate Activity';
    }

  }, 100);
}

function updateSoundLevelUI(displayText, db, peakDb) {
  const levelEl = document.getElementById('soundLevelText');
  const peakEl = document.getElementById('soundPeakText');

  if (levelEl) {
    levelEl.textContent = displayText;
    if (displayText === 'silence') {
      levelEl.className = 'text-slate-400 font-mono text-xs';
    } else {
      levelEl.className = db > -25 ? 'text-rose-400 font-mono font-bold animate-pulse' : 'text-emerald-400 font-mono font-bold';
    }
  }
  if (peakEl) {
    peakEl.textContent = peakDb <= -90 ? 'Peak: silence' : `Peak: ${peakDb} dB`;
  }
}

/**
 * Real-time waveform bar visualizer on canvas
 */
function drawActiveAudioVisualizer(timeData, db) {
  const canvas = document.getElementById('audioVisualizerCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.parentElement.clientWidth;
  canvas.height = 64;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const bars = 24;
  const barWidth = 4;
  const gap = (canvas.width - bars * barWidth) / (bars - 1);
  const step = Math.floor(timeData.length / bars);

  for (let i = 0; i < bars; i++) {
    const val = Math.abs(timeData[i * step] || 0);
    const height = Math.min(60, Math.max(4, val * 120 + (db + 60) * 0.4));
    const x = i * (barWidth + gap);
    const y = (canvas.height - height) / 2;

    ctx.fillStyle = db > -25 ? '#ef4444' : (db > -35 ? '#f59e0b' : '#10b981');
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, height, 2);
    ctx.fill();
  }
}

/**
 * Loads the YAMNet model from TensorFlow Hub with fromTFHub: true
 * and fetches the 521-class display map CSV
 */
async function loadYamnetModelAndClassMap() {
  const statusEl = document.getElementById('micYAMNetStatus');
  isYamnetModelLoading = true;
  if (statusEl) statusEl.textContent = 'Loading YAMNet...';

  try {
    // 1. Fetch class map CSV
    if (!yamnetClassMap) {
      const csvUrl = 'https://raw.githubusercontent.com/tensorflow/models/master/research/audioset/yamnet/yamnet_class_map.csv';
      try {
        const res = await fetch(csvUrl);
        if (res.ok) {
          const csvText = await res.text();
          yamnetClassMap = parseYamnetCsv(csvText);
          console.log(`Loaded ${yamnetClassMap.length} YAMNet classes from GitHub.`);
        }
      } catch (csvErr) {
        console.warn('Direct GitHub CSV fetch failed, using built-in AudioSet map:', csvErr);
        yamnetClassMap = getBuiltInYamnetClassMap();
      }
    }

    // 2. Load YAMNet Model using tf.loadGraphModel with fromTFHub: true
    if (typeof tf === 'undefined') {
      throw new Error('TensorFlow.js library not loaded.');
    }

    console.log('Loading YAMNet from TensorFlow Hub...');
    const tfhubModelUrl = 'https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1';

    try {
      yamnetModel = await tf.loadGraphModel(tfhubModelUrl, { fromTFHub: true });
      console.log('YAMNet model successfully loaded from TF Hub!');
      if (statusEl) statusEl.textContent = 'YAMNet Ready';
    } catch (hubErr) {
      console.warn('tfhub.dev direct load fallback to googleapis storage:', hubErr);
      const storageUrl = 'https://storage.googleapis.com/tfhub-tfjs-modules/google/tfjs-model/yamnet/tfjs/1/model.json';
      yamnetModel = await tf.loadGraphModel(storageUrl);
      console.log('YAMNet loaded via Google Storage mirror.');
      if (statusEl) statusEl.textContent = 'YAMNet Ready';
    }

  } catch (err) {
    console.error('YAMNet model load failure:', err);
    if (statusEl) statusEl.textContent = 'Model Offline';
  } finally {
    isYamnetModelLoading = false;
  }
}

/**
 * Parses YAMNet class map CSV (index, mid, display_name)
 */
function parseYamnetCsv(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  const classes = [];
  // Skip header (index,mid,display_name)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^\d+,[^,]+,"?([^"]+)"?$/);
    if (match) {
      classes.push(match[1]);
    } else {
      const parts = line.split(',');
      classes.push(parts.slice(2).join(',').replace(/^"|"$/g, ''));
    }
  }
  return classes;
}

/**
 * Built-in fallback map for YAMNet critical indices if offline
 */
function getBuiltInYamnetClassMap() {
  const map = new Array(521).fill('Unknown sound');
  map[0] = 'Speech';
  map[1] = 'Child speech, kid speaking';
  map[2] = 'Conversation';
  map[6] = 'Shout';
  map[9] = 'Yell';
  map[11] = 'Screaming';
  map[132] = 'Music';
  map[316] = 'Emergency vehicle';
  map[317] = 'Police car (siren)';
  map[318] = 'Ambulance (siren)';
  map[319] = 'Fire engine, fire truck (siren)';
  map[390] = 'Siren';
  map[391] = 'Civil defense siren';
  map[393] = 'Smoke detector, smoke alarm';
  map[394] = 'Fire alarm';
  map[420] = 'Explosion';
  map[421] = 'Gunshot, gunfire';
  map[434] = 'Crack';
  map[435] = 'Glass';
  map[436] = 'Chink, clink';
  map[437] = 'Shatter';
  map[460] = 'Bang';
  map[463] = 'Smash, crash';
  map[464] = 'Breaking';
  return map;
}

/**
 * YAMNet Classification Loop (Runs every 0.5s)
 * Classifies 15600 samples (0.975s at 16kHz)
 * Guard: Strictly skips if microphone is stopping or stopped, or during initial 2s calibration window.
 */
async function runYamnetClassification() {
  if (!state.micActive || state.micStopping || !yamnetModel || totalSamplesRecorded < YAMNET_WINDOW_SIZE) return;

  // Never evaluate alerts during the first 2 seconds after Start
  const elapsedSinceStart = Date.now() - state.micStartTime;
  if (elapsedSinceStart < 2000) return;

  // Check Self-Noise suppression flag: true while any alarm is sounding and for 2s after
  if (isSelfNoiseActive()) {
    const statusEl = document.getElementById('soundStatusText');
    if (statusEl) statusEl.textContent = 'Mic paused: alarm sounding';
    return;
  }

  // Also skip if continuous alarm is already running (prevent retriggering)
  if (state.isContinuousAlarmActive) return;

  try {
    // 1. Extract linear window of 15600 samples from ring buffer
    const windowSamples = new Float32Array(YAMNET_WINDOW_SIZE);
    let readIndex = ringBufferWriteIndex;
    for (let i = 0; i < YAMNET_WINDOW_SIZE; i++) {
      windowSamples[i] = audioSampleRingBuffer[readIndex];
      readIndex = (readIndex + 1) % YAMNET_WINDOW_SIZE;
    }

    // Check again before expensive tensor creation
    if (state.micStopping || !state.micActive) return;

    // 2. Wrap in tf.tensor1d float32
    const tensorWaveform = tf.tensor1d(windowSamples, 'float32');

    // 3. Execute model inference
    // YAMNet returns [scores, embeddings, log_mel_spectrogram]
    const outputs = yamnetModel.execute(tensorWaveform);
    const scoresTensor = Array.isArray(outputs) ? outputs[0] : outputs;

    // Average frame scores across window time axis
    const meanScoresTensor = scoresTensor.mean(0);
    const scoresArray = await meanScoresTensor.data();

    // Clean up tensors immediately
    tensorWaveform.dispose();
    if (Array.isArray(outputs)) {
      outputs.forEach(t => t.dispose());
    } else {
      outputs.dispose();
    }
    meanScoresTensor.dispose();

    // If stopping flag was set during async inference, discard results immediately
    if (state.micStopping || !state.micActive) return;

    // Discard results if self-noise or continuous alarm became active during inference
    if (isSelfNoiseActive() || state.isContinuousAlarmActive) {
      const statusEl = document.getElementById('soundStatusText');
      if (statusEl) statusEl.textContent = 'Mic paused: alarm sounding';
      return;
    }

    // 4. Extract Top 3 Predictions
    const predictions = [];
    const classCount = Math.min(scoresArray.length, (yamnetClassMap ? yamnetClassMap.length : 521));

    for (let i = 0; i < classCount; i++) {
      predictions.push({
        index: i,
        score: scoresArray[i],
        name: (yamnetClassMap && yamnetClassMap[i]) ? yamnetClassMap[i] : `Sound #${i}`
      });
    }

    predictions.sort((a, b) => b.score - a.score);
    const top3 = predictions.slice(0, 3);

    // 5. Update UI & Debug Panel
    updateTopSoundsUI(top3);
    updateAudioDebugPanel(top3[0], state.currentDbLevel);

    // 6. Evaluate DANGER Sound Rules (strictly blocked if mic is stopping or stopped)
    if (!state.micStopping && state.micActive) {
      evaluateDangerAudioRules(top3);
    }

  } catch (err) {
    console.error('YAMNet inference error:', err);
  }
}

/**
 * Update Top 3 Sounds List UI
 */
function updateTopSoundsUI(top3) {
  const container = document.getElementById('topSoundsList');
  if (!container || !top3 || top3.length === 0) return;

  container.innerHTML = top3.map((sound, i) => {
    const pct = Math.round(sound.score * 100);
    const isDanger = isDangerSound(sound.name);
    const isIgnored = isIgnoredSound(sound.name);

    let badgeColor = 'text-slate-700 dark:text-slate-300';
    let barColor = 'bg-emerald-500';

    if (isDanger) {
      badgeColor = 'text-rose-600 dark:text-rose-400 font-bold';
      barColor = 'bg-rose-500';
    } else if (isIgnored) {
      badgeColor = 'text-slate-400';
      barColor = 'bg-slate-400';
    }

    return `
      <div>
        <div class="flex items-center justify-between text-[11px] mb-0.5">
          <span class="${badgeColor} truncate max-w-[160px]">${sound.name}</span>
          <span class="font-mono text-slate-500 dark:text-slate-400 font-semibold">${pct}%</span>
        </div>
        <div class="w-full bg-slate-200 dark:bg-slate-700 h-1 rounded-full overflow-hidden">
          <div class="${barColor} h-1 rounded-full" style="width: ${Math.min(pct, 100)}%;"></div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Update Debug Panel with live audio sound class, confidence and dB level
 */
function updateAudioDebugPanel(topSound, dbLevel) {
  const debugAudio = document.getElementById('debugAudioInfo');
  if (debugAudio && topSound) {
    const pct = Math.round(topSound.score * 100);
    const name = topSound.name;
    const isDanger = isDangerSound(name);

    debugAudio.textContent = `${name} (${pct}%) • ${dbLevel} dBFS`;
    debugAudio.className = isDanger 
      ? 'text-rose-400 font-bold animate-pulse' 
      : 'text-amber-300 font-semibold';
  }
}

/**
 * Check if sound name matches danger categories:
 * Glass, Shatter, Breaking, Smash/crash, Gunshot/gunfire, Explosion, Screaming, Siren/Alarm
 */
function isDangerSound(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return DANGER_SOUND_KEYWORDS.some(k => lower.includes(k));
}

function isIgnoredSound(name) {
  if (!name) return false;
  const lower = name.toLowerCase();

  // 1. Normal speech/singing/music ignore list
  if (IGNORE_SOUND_KEYWORDS.some(k => lower.includes(k))) return true;

  // 2. Feedback buzzer sounds: Buzzer, Beep, Alarm clock, Smoke detector, Fire alarm, Siren
  // Always ignore if heard within 3 seconds of any BUZZ sent
  if (state.lastBuzzSentTime > 0 && (Date.now() - state.lastBuzzSentTime) < 3000) {
    if (BUZZER_FEEDBACK_SOUNDS.some(k => lower.includes(k))) {
      return true;
    }
  }

  return false;
}

/**
 * Evaluate Danger Audio Rules:
 * Triggers DANGER if confidence >= threshold (50% / 40% / 30%) and not ignored
 * Cooldown: 5 seconds per sound type
 * Guard: Absolutely forbidden if mic is stopping or stopped.
 */
function evaluateDangerAudioRules(topPredictions) {
  if (state.micStopping || !state.micActive || isSelfNoiseActive() || state.isContinuousAlarmActive) return;

  const { minConfidence } = getSensitivityThresholds();
  const now = Date.now();

  for (const pred of topPredictions) {
    const soundName = pred.name;
    const score = pred.score;

    if (isDangerSound(soundName) && !isIgnoredSound(soundName) && score >= minConfidence) {
      // Check cooldown (5 seconds per sound type)
      const lastTrigger = state.soundAlertCooldownMap[soundName] || 0;
      if (now - lastTrigger >= 5000) {
        state.soundAlertCooldownMap[soundName] = now;
        onDangerSoundAlert(soundName, score);
        break; // Trigger highest priority
      }
    }
  }
}

/**
 * DANGER Audio Alert: Starts Continuous Alarm, updates table, charts, counters
 * Guard: Never executes if microphone is stopping or stopped, or if alarm is sounding.
 */
function onDangerSoundAlert(soundName, score) {
  if (state.micStopping || !state.micActive || isSelfNoiseActive() || state.isContinuousAlarmActive) {
    console.log(`Suppressed danger sound alert '${soundName}' because microphone is stopping, stopped, or alarm is already sounding.`);
    return;
  }

  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const pct = Math.round(score * 100);

  // 1. Show Red Banner with Silence button
  triggerAlertBanner(`DANGER: ${soundName.toUpperCase()} detected (${pct}%) at ${timeStr}`, 'danger');
  const silenceBtn = document.getElementById('silenceAlarmBtn');
  if (silenceBtn) silenceBtn.classList.remove('hidden');

  // 2. Start continuous alarm (device buzzer BUZZ every 1 sec + laptop continuous sound)
  state.lastHarmfulObjectSeenTime = Date.now(); // 10-sec timeout timer
  if (!state.isContinuousAlarmActive) {
    startContinuousDangerAlarm();
  }

  // 3. Add to Recent alerts table (Source = Microphone, Severity = Danger)
  const newAlert = {
    id: Date.now(),
    time: timeStr,
    severity: 'Danger',
    type: 'Sound',
    source: 'Microphone',
    details: `${soundName.toUpperCase()} detected (${pct}%)`,
    distance: 'N/A',
    status: 'Critical',
    aiCheck: 'none',
    aiChecked: false,
    ts: Date.now()
  };
  state.alerts.unshift(newAlert);
  renderAlertsTable(state.alerts);

  // Save to Cloud Firestore
  saveAlertToFirestore(newAlert);

  // 4. Update Stats counters & Charts
  state.stats.alertsToday += 1;
  state.stats.soundAlerts += 1;
  updateStatsDisplay();

  if (chartAlertsByType) {
    chartAlertsByType.data.datasets[0].data[2] += 1; // Sound category
    chartAlertsByType.update();
  }
  const donutTotal = document.getElementById('donutTotalCount');
  if (donutTotal) donutTotal.textContent = state.stats.alertsToday;
}

/**
 * CAUTION Audio Alert: Very loud sudden sound jump
 * Follows selected Alarm Output setting (Device / Laptop / Both)
 * Cooldown: 5 seconds
 * Guard: Never executes if microphone is stopping or stopped.
 */
function onCautionLoudSoundAlert(db, jumpDb) {
  if (state.micStopping || !state.micActive || isSelfNoiseActive() || state.isContinuousAlarmActive) {
    console.log(`Suppressed loud sound caution alert because microphone is stopping, stopped, or alarm is sounding.`);
    return;
  }

  const now = Date.now();
  if (now - state.lastAudioCautionAlertTime < 5000) return;
  state.lastAudioCautionAlertTime = now;

  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // 1. Show Yellow Banner
  triggerAlertBanner(`⚠️ Caution: Loud sound detected (${db} dBFS, +${jumpDb} dB surge)!`, 'caution');

  // 2. Dispatch alarm output according to Alarm Output setting
  triggerAlarmOutput('Loud Sound Detected');

  // 3. Add to Recent alerts table (Source = Microphone, Severity = Caution)
  const newAlert = {
    id: Date.now(),
    time: timeStr,
    severity: 'Caution',
    type: 'Sound',
    source: 'Microphone',
    details: `Loud sound jump (${db} dBFS, +${jumpDb} dB surge)`,
    distance: 'N/A',
    status: 'Warning',
    aiCheck: 'none',
    aiChecked: false,
    ts: now
  };
  state.alerts.unshift(newAlert);
  renderAlertsTable(state.alerts);

  // Save to Cloud Firestore
  saveAlertToFirestore(newAlert);

  // 4. Update Stats counters & Charts
  state.stats.alertsToday += 1;
  state.stats.soundAlerts += 1;
  updateStatsDisplay();

  if (chartAlertsByType) {
    chartAlertsByType.data.datasets[0].data[2] += 1;
    chartAlertsByType.update();
  }
  const donutTotal = document.getElementById('donutTotalCount');
  if (donutTotal) donutTotal.textContent = state.stats.alertsToday;
}

/**
 * Test button: Simulates a Glass Break / Shatter sound detection
 */
function simulateGlassBreakAlarm() {
  console.log('Simulating Glass Break / Shatter danger sound detection...');
  onDangerSoundAlert('Shatter (Glass break)', 0.94);
}

/* ========================================================
   IDLE AUDIO VISUALIZER (Wave Animation)
======================================================== */
function initAudioVisualizerIdle() {
  const canvas = document.getElementById('audioVisualizerCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let step = 0;

  function draw() {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = 64;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const bars = 24;
    const barWidth = 4;
    const gap = (canvas.width - bars * barWidth) / (bars - 1);

    for (let i = 0; i < bars; i++) {
      const height = 8 + Math.sin((step + i * 0.4)) * 6 + Math.cos(i * 0.8) * 4;
      const x = i * (barWidth + gap);
      const y = (canvas.height - height) / 2;

      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, height, 2);
      ctx.fill();
    }

    step += 0.05;
    requestAnimationFrame(draw);
  }

  draw();
}
