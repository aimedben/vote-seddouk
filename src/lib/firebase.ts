import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  collection,
  query,
  getDocs,
  onSnapshot,
  increment,
  writeBatch,
  Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { initialParties, initialCandidates, initialSettings } from '../data/initialData';
import { Party, Candidate, ElectionSettings, Ballot, AuditLog } from '../types';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// OperationType and Error Handling per SKILL.md
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map((provider) => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Authentication helpers
export async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error('Google Sign-In Error:', error);
    throw error;
  }
}

export async function signInWithEmail(email: string, pass: string) {
  try {
    const result = await signInWithEmailAndPassword(auth, email, pass);
    return result.user;
  } catch (error) {
    console.error('Email Sign-In Error:', error);
    throw error;
  }
}

export async function signUpWithEmail(email: string, pass: string) {
  try {
    const result = await createUserWithEmailAndPassword(auth, email, pass);
    return result.user;
  } catch (error) {
    console.error('Email Sign-Up Error:', error);
    throw error;
  }
}

export async function logOut() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error('Sign-Out Error:', error);
    throw error;
  }
}

// Check admin role
export function isUserAdmin(user: User | null): boolean {
  if (!user) return false;
  // Superadmin whitelist from user instructions / environment
  if (user.email === 'seddouk2004@gmail.com') return true;
  return false;
}

// Validate connection on boot as required by SKILL.md
export async function testFirestoreConnection() {
  const testPath = `settings/${initialSettings.id}`;
  try {
    await getDocFromServer(doc(db, 'settings', initialSettings.id));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase client is offline, retrying...');
    }
  }
}

// Seed initial data into Firestore if not present
export async function seedFirestoreIfEmpty() {
  const partiesPath = 'parties';
  try {
    const partiesSnap = await getDocs(collection(db, partiesPath));
    if (partiesSnap.empty) {
      console.log('Seeding Firestore with initial 4 parties and 104 candidates...');
      const batch = writeBatch(db);

      // Seed Settings
      batch.set(doc(db, 'settings', initialSettings.id), initialSettings);

      // Seed Parties
      for (const p of initialParties) {
        batch.set(doc(db, 'parties', p.id), p);
      }

      await batch.commit();

      // Seed Candidates in batches (batches max 500 ops)
      let cBatch = writeBatch(db);
      let count = 0;
      for (const c of initialCandidates) {
        cBatch.set(doc(db, 'candidates', c.id), c);
        count++;
        if (count >= 400) {
          await cBatch.commit();
          cBatch = writeBatch(db);
          count = 0;
        }
      }
      if (count > 0) {
        await cBatch.commit();
      }
      console.log('Firestore seed completed successfully!');
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, partiesPath);
  }
}

// Record a citizen vote into Firestore
export async function submitBallotToFirestore(
  ballotId: string,
  partyId: string,
  candidateIds: string[]
): Promise<void> {
  const ballotPath = `ballots/${ballotId}`;
  try {
    const newBallot = {
      id: ballotId,
      partyId,
      candidateIds,
      createdAt: new Date().toISOString(),
    };

    // 1. Create ballot doc in Firestore
    await setDoc(doc(db, 'ballots', ballotId), newBallot);

    // 2. Increment party ballotCount in Firestore
    try {
      await updateDoc(doc(db, 'parties', partyId), {
        ballotCount: increment(1),
      });
    } catch (e) {
      console.warn('Party increment on client rules:', e);
    }

    // 3. Increment candidate voteCount in Firestore
    for (const cId of candidateIds) {
      try {
        await updateDoc(doc(db, 'candidates', cId), {
          voteCount: increment(1),
        });
      } catch (e) {
        console.warn('Candidate increment on client rules:', e);
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, ballotPath);
  }
}

// Real-time listener for parties from Firestore
export function listenToFirestoreParties(
  onUpdate: (parties: Party[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'parties';
  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      const parties: Party[] = [];
      snapshot.forEach((d) => {
        parties.push(d.data() as Party);
      });
      parties.sort((a, b) => a.displayOrder - b.displayOrder);
      onUpdate(parties);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (err: any) {
        if (onError) onError(err);
      }
    }
  );
}

// Real-time listener for candidates from Firestore
export function listenToFirestoreCandidates(
  onUpdate: (candidates: Candidate[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'candidates';
  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      const candidates: Candidate[] = [];
      snapshot.forEach((d) => {
        candidates.push(d.data() as Candidate);
      });
      candidates.sort((a, b) => a.listPosition - b.listPosition);
      onUpdate(candidates);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (err: any) {
        if (onError) onError(err);
      }
    }
  );
}

// Real-time listener for settings from Firestore
export function listenToFirestoreSettings(
  onUpdate: (settings: ElectionSettings) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `settings/${initialSettings.id}`;
  return onSnapshot(
    doc(db, 'settings', initialSettings.id),
    (snapshot) => {
      if (snapshot.exists()) {
        onUpdate(snapshot.data() as ElectionSettings);
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (err: any) {
        if (onError) onError(err);
      }
    }
  );
}
