// Firebase Auth 封裝:Google 登入 / 登出 / 狀態監聽。
// emulator 模式:hostname=localhost 且 URL 含 ?emu=1 時 connectAuthEmulator。
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, connectAuthEmulator } from 'firebase/auth';
import { app } from './firebase.js';

const auth = getAuth(app);

// emulator 判斷:hostname 守門,正式環境不會觸發
const isEmuMode =
  typeof window !== 'undefined' &&
  window.location.hostname === 'localhost' &&
  new URLSearchParams(window.location.search).get('emu') === '1';

if (isEmuMode) {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
}

export function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
}

export function signOutUser() {
  return signOut(auth);
}

export function onAuth(callback) {
  return onAuthStateChanged(auth, callback);
}
