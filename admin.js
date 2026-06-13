const ADMIN_EMAILS = (window.MARKET_CODE_ADMIN_EMAILS || [window.MARKET_CODE_ADMIN_EMAIL || "ahmedeng199d@gmail.com"]).map((email) => String(email).toLowerCase());
const $ = (id) => document.getElementById(id);
const adminStatus = $("adminStatus");
const adminLoginBtn = $("adminLoginBtn");
const adminLogoutBtn = $("adminLogoutBtn");
const generateKeyBtn = $("generateKeyBtn");
const copyKeyBtn = $("copyKeyBtn");
const generatedKey = $("generatedKey");
const keyList = $("keyList");
let auth = null;
let db = null;
let lastKey = "";

function setStatus(message, type = "") {
  adminStatus.textContent = message;
  adminStatus.classList.remove("ok", "err");
  if (type) adminStatus.classList.add(type);
}

function randomPart(length = 4) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  crypto.getRandomValues(new Uint32Array(length)).forEach((value) => {
    out += chars[value % chars.length];
  });
  return out;
}

function makeKey() {
  return `MOFX-${randomPart()}-${randomPart()}-${randomPart()}-LIFE`;
}

function isAdmin(user) {
  return user && ADMIN_EMAILS.includes(String(user.email || "").toLowerCase());
}

function setUi(user) {
  const admin = isAdmin(user);
  adminLoginBtn.classList.toggle("hidden", !!user);
  adminLogoutBtn.classList.toggle("hidden", !user);
  generateKeyBtn.classList.toggle("hidden", !admin);
  copyKeyBtn.classList.toggle("hidden", !lastKey);

  if (!user) setStatus("Please login with an admin email.");
  else if (!admin) setStatus(`Logged in as ${user.email}. You are not authorized to generate keys.`, "err");
  else setStatus(`Admin verified: ${user.email}. You can generate keys.`, "ok");
}

async function init() {
  try {
    if (!window.firebase || !window.firebaseConfig) {
      setStatus("Firebase is not loaded. Check firebase-config.js.", "err");
      return;
    }
    if (!firebase.apps.length) firebase.initializeApp(window.firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();

    auth.onAuthStateChanged((user) => {
      setUi(user);
      if (isAdmin(user)) loadLatestKeys();
      else keyList.innerHTML = "";
    });
  } catch (error) {
    console.error(error);
    setStatus("Firebase setup error.", "err");
  }
}

async function login() {
  try {
    await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Login failed.", "err");
  }
}

async function logout() {
  await auth.signOut();
}

async function generateKey() {
  const user = auth.currentUser;
  if (!isAdmin(user)) return setStatus("Only the admin email can generate keys.", "err");

  generateKeyBtn.disabled = true;
  try {
    let key = makeKey();
    let ref = db.collection("accessKeys").doc(key);
    let exists = await ref.get();
    while (exists.exists) {
      key = makeKey();
      ref = db.collection("accessKeys").doc(key);
      exists = await ref.get();
    }

    await ref.set({
      key,
      used: false,
      usedBy: null,
      usedByEmail: null,
      lifetime: true,
      active: true,
      stopped: false,
      createdBy: user.uid,
      createdByEmail: user.email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    lastKey = key;
    generatedKey.textContent = key;
    generatedKey.classList.remove("hidden");
    copyKeyBtn.classList.remove("hidden");
    setStatus("Key generated successfully.", "ok");
    await loadLatestKeys();
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Could not generate key. Check Firestore Rules.", "err");
  } finally {
    generateKeyBtn.disabled = false;
  }
}

async function copyKey() {
  if (!lastKey) return;
  await navigator.clipboard.writeText(lastKey).catch(() => {});
  setStatus("Key copied.", "ok");
}

async function stopGeneratedKey(key) {
  const user = auth.currentUser;
  if (!isAdmin(user)) return setStatus("Only admins can stop keys.", "err");
  if (!key) return;
  const sure = confirm(`Stop this key and revoke access?

${key}`);
  if (!sure) return;
  try {
    const keyRef = db.collection("accessKeys").doc(key);
    const keySnap = await keyRef.get();
    if (!keySnap.exists) throw new Error("Key not found.");
    const data = keySnap.data();

    const batch = db.batch();
    batch.set(keyRef, {
      active: false,
      stopped: true,
      stoppedAt: firebase.firestore.FieldValue.serverTimestamp(),
      stoppedBy: user.uid,
      stoppedByEmail: user.email
    }, { merge: true });

    if (data.usedBy) {
      const userRef = db.collection("users").doc(data.usedBy);
      batch.set(userRef, {
        accessGranted: false,
        accessStopped: true,
        stoppedKey: key,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    await batch.commit();
    setStatus("Key stopped and linked access revoked.", "ok");
    await loadLatestKeys();
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Could not stop key.", "err");
  }
}

async function loadLatestKeys() {
  try {
    const snap = await db.collection("accessKeys").orderBy("createdAt", "desc").limit(20).get();
    keyList.innerHTML = "";
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      const key = data.key || docSnap.id;
      const stopped = data.stopped === true || data.active === false;
      const row = document.createElement("div");
      row.className = `key-row${stopped ? " stopped" : ""}`;
      row.innerHTML = `
        <strong>${key}</strong>
        <button class="stop-key-btn" type="button" data-key="${key}" ${stopped ? "disabled" : ""}>${stopped ? "Stopped" : "Stop"}</button>
        <small>${stopped ? "Stopped / access revoked" : data.used ? `Used by: ${data.usedByEmail || "unknown"}` : "Unused / ready"}</small>
      `;
      const btn = row.querySelector(".stop-key-btn");
      if (btn && !stopped) btn.addEventListener("click", () => stopGeneratedKey(key));
      keyList.appendChild(row);
    });
  } catch (error) {
    console.warn(error);
    keyList.innerHTML = `<div class="key-row">Could not load keys. You may need to create an index, or generate the first key.</div>`;
  }
}


adminLoginBtn.addEventListener("click", login);
adminLogoutBtn.addEventListener("click", logout);
generateKeyBtn.addEventListener("click", generateKey);
copyKeyBtn.addEventListener("click", copyKey);
init();
