import { auth } from "./firebase.js";
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signInAnonymously,
    signOut,
    onAuthStateChanged,
    updateProfile,
} from "firebase/auth";

export { signOut, onAuthStateChanged, auth };

export async function loginEmail(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
}

export async function registerEmail(email, password, name) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (name) await updateProfile(cred.user, { displayName: name });
    return cred;
}

export async function loginGuest() {
    return signInAnonymously(auth);
}

export function getDisplayName(user) {
    if (!user) return "Guest";
    if (user.isAnonymous) return "Guest";
    return user.displayName || user.email?.split("@")[0] || "User";
}

export function getInitials(user) {
    const name = getDisplayName(user);
    return name.slice(0, 2).toUpperCase();
}

/** Renders the auth screen into #app, calls onSuccess(user) on login */
export function renderAuthScreen(onSuccess) {
    document.getElementById("app").innerHTML = `
    <div class="auth-bg">
      <div class="auth-glow-1"></div>
      <div class="auth-glow-2"></div>
      <div class="auth-card">
        <div class="auth-brand">
          <div class="auth-brand-icon">📈</div>
          <div>
            <div class="auth-brand-name">AlphaInsight <span class="auth-brand-pro">Pro</span></div>
            <div class="auth-brand-sub">AI Financial Intelligence Platform</div>
          </div>
        </div>

        <div class="auth-tabs">
          <button class="auth-tab active" id="tab-login">Sign In</button>
          <button class="auth-tab" id="tab-register">Register</button>
        </div>

        <div id="auth-error" class="auth-error" style="display:none;"></div>
        <div id="auth-info" class="auth-info" style="display:none;"></div>

        <form id="auth-form" autocomplete="on">
          <div class="auth-field" id="name-group" style="display:none;">
            <label class="auth-label">Full Name</label>
            <input class="auth-input" type="text" id="auth-name" placeholder="Jane Analyst" autocomplete="name"/>
          </div>
          <div class="auth-field">
            <label class="auth-label">Email Address</label>
            <input class="auth-input" type="email" id="auth-email" placeholder="you@company.com" required autocomplete="email"/>
          </div>
          <div class="auth-field">
            <label class="auth-label">Password</label>
            <div class="pw-wrapper">
              <input class="auth-input pw-input" type="password" id="auth-password" placeholder="••••••••" required minlength="6" autocomplete="current-password"/>
              <button type="button" id="toggle-pw" class="pw-toggle" title="Show/hide password">👁</button>
            </div>
          </div>
          <button type="submit" class="auth-btn-primary" id="auth-submit">Sign In</button>
        </form>

        <div class="auth-divider"><span>or</span></div>

        <button class="auth-btn-ghost" id="btn-guest">
          <span>👤</span> Continue as Guest
        </button>

        <p class="auth-footnote">
          Data is protected by server-side Firebase security rules.<br/>
          Guest accounts are temporary — sign up to save your work.
        </p>
      </div>
    </div>`;

    let isLogin = true;

    const $ = (id) => document.getElementById(id);
    const showErr = (msg) => { if (!msg) { $("auth-error").style.display = "none"; return; } $("auth-error").textContent = msg; $("auth-error").style.display = "block"; };
    const showInfo = (msg) => { if (!msg) { $("auth-info").style.display = "none"; return; } $("auth-info").textContent = msg; $("auth-info").style.display = "block"; };

    $("tab-login").onclick = () => {
        isLogin = true;
        $("tab-login").classList.add("active"); $("tab-register").classList.remove("active");
        $("name-group").style.display = "none";
        $("auth-submit").textContent = "Sign In";
        showErr(null); showInfo(null);
    };

    $("tab-register").onclick = () => {
        isLogin = false;
        $("tab-register").classList.add("active"); $("tab-login").classList.remove("active");
        $("name-group").style.display = "block";
        $("auth-submit").textContent = "Create Account";
        showErr(null); showInfo(null);
    };

    $("toggle-pw").onclick = () => {
        const pw = $("auth-password");
        pw.type = pw.type === "password" ? "text" : "password";
        $("toggle-pw").textContent = pw.type === "password" ? "👁" : "🙈";
    };

    $("auth-form").onsubmit = async (e) => {
        e.preventDefault();
        const email = $("auth-email").value.trim();
        const password = $("auth-password").value;
        const name = $("auth-name")?.value.trim();
        const btn = $("auth-submit");
        btn.disabled = true;
        btn.textContent = isLogin ? "Signing in…" : "Creating account…";
        showErr(null);
        try {
            const cred = isLogin
                ? await loginEmail(email, password)
                : await registerEmail(email, password, name);
            onSuccess(cred.user);
        } catch (err) {
            showErr(friendlyError(err.code));
            if (err.code === "auth/operation-not-allowed") {
                showInfo("⚡ Fix: Go to Firebase Console → Authentication → Sign-in method → Enable Email/Password");
            }
            btn.disabled = false;
            btn.textContent = isLogin ? "Sign In" : "Create Account";
        }
    };

    $("btn-guest").onclick = async () => {
        const btn = $("btn-guest");
        btn.disabled = true; btn.textContent = "Connecting…";
        showErr(null);
        try {
            const cred = await loginGuest();
            onSuccess(cred.user);
        } catch (err) {
            showErr(friendlyError(err.code));
            if (err.code === "auth/operation-not-allowed") {
                showInfo("⚡ Fix: Go to Firebase Console → Authentication → Sign-in method → Enable Anonymous");
            }
            btn.disabled = false; btn.textContent = "👤 Continue as Guest";
        }
    };
}

function friendlyError(code) {
    const m = {
        "auth/invalid-email": "Please enter a valid email address.",
        "auth/user-not-found": "No account found. Try registering.",
        "auth/wrong-password": "Incorrect password. Please try again.",
        "auth/invalid-credential": "Invalid email or password.",
        "auth/email-already-in-use": "Email already registered — try signing in.",
        "auth/weak-password": "Password must be at least 6 characters.",
        "auth/too-many-requests": "Too many attempts. Please wait and retry.",
        "auth/operation-not-allowed": "This sign-in method is not enabled in Firebase Console.",
    };
    return m[code] || `Error: ${code}`;
}
