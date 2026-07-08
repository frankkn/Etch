import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// firebaseConfig 不是秘密：它只是專案的公開識別。
// 安全來自 Security Rules（firestore.rules）與客戶端 E2E 加密。
const firebaseConfig = {
  apiKey: 'REDACTED_FIREBASE_API_KEY',
  authDomain: 'etch-5ae60.firebaseapp.com',
  projectId: 'etch-5ae60',
  storageBucket: 'etch-5ae60.firebasestorage.app',
  messagingSenderId: '87978711432',
  appId: '1:87978711432:web:eb4515a614ea1ce88b423d',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export function signInWithGoogle() {
  return signInWithPopup(auth, new GoogleAuthProvider());
}

export function signOutUser() {
  return signOut(auth);
}
