import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { initialSettings, initialParties, initialCandidates } from './src/data/initialData.js';
import type { ElectionSettings, Party, Candidate, Ballot, AuditLog, SecurityRecord, ResultsData, PartyResult, CandidateResult } from './src/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'server_data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SERVER_SECRET = process.env.VOTE_SECRET || 'seddouk-2026-elections-secret-key-dz-06';

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory + persisted DB structure
interface DatabaseState {
  settings: ElectionSettings;
  parties: Party[];
  candidates: Candidate[];
  ballots: Ballot[];
  admin: {
    username: string;
    passwordHash: string;
    mustChangePassword: boolean;
  };
  auditLogs: AuditLog[];
  securityRecords: SecurityRecord[];
}

function hashPassword(pwd: string): string {
  return crypto.createHmac('sha256', SERVER_SECRET).update(pwd).digest('hex');
}

// Initialize database
function loadDatabase(): DatabaseState {
  if (fs.existsSync(DB_FILE)) {
    try {
      const content = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      return parsed;
    } catch (e) {
      console.error('Error reading db.json, recreating...', e);
    }
  }

  const initialDb: DatabaseState = {
    settings: initialSettings,
    parties: initialParties,
    candidates: initialCandidates,
    ballots: [],
    admin: {
      username: 'admin',
      passwordHash: hashPassword('aimed004'),
      mustChangePassword: true,
    },
    auditLogs: [
      {
        id: 'init-1',
        adminUsername: 'system',
        action: 'INITIALISATION',
        entityType: 'database',
        entityId: 'all',
        entityName: 'Plateforme Seddouk Elections 2026',
        oldValue: null,
        adjustment: null,
        newValue: 'Initialisation complète avec les 4 listes officielles',
        reason: 'Démarrage du système',
        createdAt: new Date().toISOString(),
      },
    ],
    securityRecords: [],
  };

  saveDatabase(initialDb);
  return initialDb;
}

// Atomic save using temporary file rename
function saveDatabase(db: DatabaseState) {
  const tmpFile = `${DB_FILE}.tmp.${Date.now()}`;
  fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2), 'utf-8');
  fs.renameSync(tmpFile, DB_FILE);
}

let db = loadDatabase();

// Helper to hash IP
function getClientIpFingerprint(req: express.Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  let rawIp = '';
  if (typeof forwarded === 'string') {
    rawIp = forwarded.split(',')[0].trim();
  } else if (Array.isArray(forwarded)) {
    rawIp = forwarded[0].trim();
  } else {
    rawIp = req.socket.remoteAddress || req.ip || '127.0.0.1';
  }

  // Normalize IPv4-mapped IPv6
  if (rawIp.startsWith('::ffff:')) {
    rawIp = rawIp.replace('::ffff:', '');
  }

  return crypto.createHmac('sha256', SERVER_SECRET).update(rawIp).digest('hex');
}

// Simple admin session management
const adminSessions = new Set<string>();

// Real-time SSE notification subscribers for mobile apps & web
const sseClients = new Set<express.Response>();

function broadcastVoteEvent(eventData: any) {
  const payload = `data: ${JSON.stringify(eventData)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

function createAdminSession(): string {
  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.add(token);
  return token;
}

function verifyAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Accès administrateur non autorisé.' });
  }
  const token = authHeader.split(' ')[1];
  if (!adminSessions.has(token)) {
    return res.status(401).json({ error: 'Session expirée ou invalide.' });
  }
  next();
}

// Compute dynamic results
function computeResults(): ResultsData {
  const totalBallots = db.ballots.length;

  // Ballots by party
  const partyBallotCounts: Record<string, number> = {};
  for (const party of db.parties) {
    partyBallotCounts[party.id] = party.manualVoteAdjustment || 0;
  }

  // Candidate votes
  const candidateVotes: Record<string, number> = {};
  for (const c of db.candidates) {
    candidateVotes[c.id] = c.manualVoteAdjustment || 0;
  }

  // Sum from actual ballots
  for (const b of db.ballots) {
    partyBallotCounts[b.partyId] = (partyBallotCounts[b.partyId] || 0) + 1;
    for (const cId of b.candidateIds) {
      candidateVotes[cId] = (candidateVotes[cId] || 0) + 1;
    }
  }

  // Calculate party total valid ballots (sum of party ballots)
  const sumValidBallots = Object.values(partyBallotCounts).reduce((a, b) => a + b, 0);

  // Build sorted party results
  const partyResults: PartyResult[] = db.parties
    .filter((p) => p.isPublic)
    .map((p) => {
      const count = partyBallotCounts[p.id] || 0;
      const percentage = sumValidBallots > 0 ? Number(((count / sumValidBallots) * 100).toFixed(1)) : 0;
      const candidateCount = db.candidates.filter((c) => c.partyId === p.id && c.isActive).length;
      return {
        id: p.id,
        name: p.name,
        arabicName: p.arabicName,
        listNumber: p.listNumber,
        logoUrl: p.logoUrl,
        themeColor: p.themeColor,
        accentColor: p.accentColor,
        ballotCount: count,
        percentage,
        rank: 1, // calculated next
        candidateCount,
      };
    });

  // Sort parties by ballot count descending
  partyResults.sort((a, b) => b.ballotCount - a.ballotCount || a.listNumber - b.listNumber);

  // Assign ranks with tie handling
  let currentRank = 1;
  for (let i = 0; i < partyResults.length; i++) {
    if (i > 0 && partyResults[i].ballotCount === partyResults[i - 1].ballotCount) {
      partyResults[i].rank = partyResults[i - 1].rank;
    } else {
      partyResults[i].rank = currentRank;
    }
    currentRank++;
  }

  // Build candidates by party
  const candidatesByParty: Record<string, CandidateResult[]> = {};

  for (const p of db.parties) {
    const pBallots = partyBallotCounts[p.id] || 0;
    const pCandidates = db.candidates
      .filter((c) => c.partyId === p.id && c.isActive)
      .map((c) => {
        const vCount = candidateVotes[c.id] || 0;
        const percentage = pBallots > 0 ? Number(((vCount / pBallots) * 100).toFixed(1)) : 0;
        return {
          id: c.id,
          partyId: c.partyId,
          listPosition: c.listPosition,
          firstName: c.firstName,
          lastName: c.lastName,
          arabicName: c.arabicName,
          photoUrl: c.photoUrl,
          profession: c.profession,
          age: c.age,
          voteCount: vCount,
          percentage,
          rank: 1,
        };
      });

    // Sort by voteCount descending, then position ascending
    pCandidates.sort((a, b) => b.voteCount - a.voteCount || a.listPosition - b.listPosition);

    // Assign rank with tie handling
    let candRank = 1;
    for (let j = 0; j < pCandidates.length; j++) {
      if (j > 0 && pCandidates[j].voteCount === pCandidates[j - 1].voteCount) {
        pCandidates[j].rank = pCandidates[j - 1].rank;
      } else {
        pCandidates[j].rank = candRank;
      }
      candRank++;
    }

    candidatesByParty[p.id] = pCandidates;
  }

  return {
    publicResultsEnabled: db.settings.publicResultsEnabled,
    resultsStatus: db.settings.resultsStatus,
    totalBallots: sumValidBallots,
    parties: partyResults,
    candidatesByParty,
    lastUpdated: new Date().toISOString(),
  };
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // --- PUBLIC API ---

  // 1. Get election status & voter IP status
  app.get('/api/status', (req, res) => {
    const ipFingerprint = getClientIpFingerprint(req);
    const hasVoted = db.ballots.some((b) => b.ipFingerprint === ipFingerprint);
    const totalValid = db.ballots.length + db.parties.reduce((acc, p) => acc + (p.manualVoteAdjustment || 0), 0);

    res.json({
      settings: db.settings,
      hasVoted,
      totalValidBallots: totalValid,
      totalParties: db.parties.filter((p) => p.isPublic).length,
      totalCandidates: db.candidates.filter((c) => c.isActive).length,
    });
  });

  // 2. Get parties with candidates for voting
  app.get('/api/parties', (req, res) => {
    const visibleParties = db.parties
      .filter((p) => p.isPublic)
      .sort((a, b) => a.displayOrder - b.displayOrder);

    const partiesWithCandidates = visibleParties.map((p) => {
      const candidates = db.candidates
        .filter((c) => c.partyId === p.id && c.isActive)
        .sort((a, b) => a.listPosition - b.listPosition);
      return {
        ...p,
        candidates,
      };
    });

    res.json(partiesWithCandidates);
  });

  // 3. Get results & ranking
  app.get('/api/results', (req, res) => {
    const results = computeResults();
    if (!results.publicResultsEnabled) {
      return res.json({
        publicResultsEnabled: false,
        resultsStatus: results.resultsStatus,
        message: 'Les résultats ne sont pas encore rendus publics par l\'administration.',
        totalBallots: 0,
        parties: [],
        candidatesByParty: {},
        lastUpdated: results.lastUpdated,
      });
    }
    res.json(results);
  });

  // 4. Submit Vote
  app.post('/api/vote', (req, res) => {
    const { partyId, candidateIds } = req.body;
    const ipFingerprint = getClientIpFingerprint(req);

    // Check IP restriction if enabled
    if (db.settings.ipProtectionEnabled) {
      const secRec = db.securityRecords.find((s) => s.ipFingerprint === ipFingerprint);
      if (secRec && secRec.status === 'blocked') {
        return res.status(403).json({
          error: 'Votre adresse IP a été bloquée pour cause de requêtes suspectes.',
          code: 'IP_BLOCKED',
        });
      }

      const alreadyVoted = db.ballots.some((b) => b.ipFingerprint === ipFingerprint);
      if (alreadyVoted && (!secRec || secRec.status !== 'unblocked')) {
        // Record blocked attempt
        if (secRec) {
          secRec.attemptsCount += 1;
          secRec.lastAttempt = new Date().toISOString();
        } else {
          db.securityRecords.push({
            ipFingerprint,
            firstSeen: new Date().toISOString(),
            lastAttempt: new Date().toISOString(),
            attemptsCount: 1,
            status: 'blocked',
            reason: 'Tentative de vote multiple refusée',
          });
        }
        saveDatabase(db);

        return res.status(403).json({
          error: 'Vous avez déjà participé au vote. Un seul vote est autorisé par adresse IP. Merci de votre compréhension.',
          code: 'ALREADY_VOTED',
        });
      }
    }

    // Validate party
    const party = db.parties.find((p) => p.id === partyId && p.isPublic);
    if (!party) {
      return res.status(400).json({ error: 'Liste candidate invalide ou indisponible.' });
    }

    // Validate candidates array
    if (!Array.isArray(candidateIds)) {
      return res.status(400).json({ error: 'Format des candidats invalide.' });
    }

    const minC = db.settings.minCandidates || 1;
    const maxC = db.settings.maxCandidates || 10;

    if (candidateIds.length < minC || candidateIds.length > maxC) {
      return res.status(400).json({
        error: `Vous devez sélectionner entre ${minC} et ${maxC} candidats maximum.`,
      });
    }

    // Check uniqueness within ballot
    const uniqueCandIds = new Set(candidateIds);
    if (uniqueCandIds.size !== candidateIds.length) {
      return res.status(400).json({ error: 'Un candidat ne peut pas être sélectionné plusieurs fois.' });
    }

    // Check all candidates belong to this party
    for (const cId of candidateIds) {
      const cand = db.candidates.find((c) => c.id === cId && c.partyId === partyId && c.isActive);
      if (!cand) {
        return res.status(400).json({
          error: 'Sélection invalide : un ou plusieurs candidats n\'appartiennent pas à la liste choisie.',
        });
      }
    }

    // Create Ballot
    const newBallot: Ballot = {
      id: `ballot-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      partyId,
      candidateIds,
      ipFingerprint,
      createdAt: new Date().toISOString(),
    };

    // Atomic transaction
    db.ballots.push(newBallot);

    // Update security records
    const existingSec = db.securityRecords.find((s) => s.ipFingerprint === ipFingerprint);
    if (existingSec) {
      existingSec.status = 'voted';
      existingSec.lastAttempt = new Date().toISOString();
      existingSec.attemptsCount += 1;
    } else {
      db.securityRecords.push({
        ipFingerprint,
        firstSeen: new Date().toISOString(),
        lastAttempt: new Date().toISOString(),
        attemptsCount: 1,
        status: 'voted',
      });
    }

    saveDatabase(db);

    // Calculate updated total valid ballots
    const totalValid = db.ballots.length + db.parties.reduce((acc, p) => acc + (p.manualVoteAdjustment || 0), 0);

    // Broadcast real-time vote event to mobile and web subscribers
    broadcastVoteEvent({
      type: 'new_vote',
      partyId,
      partyName: party.name,
      listNumber: party.listNumber,
      candidateCount: candidateIds.length,
      timestamp: newBallot.createdAt,
      totalBallots: totalValid,
    });

    res.json({
      success: true,
      ballotId: newBallot.id,
      message: 'Vote enregistré avec succès.',
    });
  });

  // 5. Server-Sent Events (SSE) for Real-Time Vote Notifications
  app.get('/api/live-votes', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    sseClients.add(res);

    const totalValid = db.ballots.length + db.parties.reduce((acc, p) => acc + (p.manualVoteAdjustment || 0), 0);
    res.write(`data: ${JSON.stringify({ type: 'connected', totalBallots: totalValid })}\n\n`);

    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  // --- ADMIN API ---

  // Admin Firebase Authentication Session Exchange (Google & Email/Password)
  app.post('/api/admin/firebase-auth', (req, res) => {
    const { email, uid } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email requis.' });
    }

    // Superadmin verification (seddouk2004@gmail.com)
    if (email.toLowerCase() === 'seddouk2004@gmail.com') {
      const token = createAdminSession();
      return res.json({
        success: true,
        token,
        username: email,
        mustChangePassword: false,
      });
    }

    return res.status(403).json({
      error: 'Ce compte Google/Email n\'a pas les privilèges administrateur pour Seddouk 2026.',
    });
  });

  // Admin Login (Classic Credentials Fallback)
  app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis.' });
    }

    if (username !== db.admin.username) {
      return res.status(401).json({ error: 'Identifiants incorrects.' });
    }

    const hashedInput = hashPassword(password);
    if (hashedInput !== db.admin.passwordHash) {
      return res.status(401).json({ error: 'Identifiants incorrects.' });
    }

    const token = createAdminSession();
    res.json({
      token,
      username: db.admin.username,
      mustChangePassword: db.admin.mustChangePassword,
    });
  });

  // Change admin password
  app.post('/api/admin/change-password', verifyAdmin, (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit comporter au moins 6 caractères.' });
    }

    db.admin.passwordHash = hashPassword(newPassword);
    db.admin.mustChangePassword = false;

    db.auditLogs.unshift({
      id: `log-${Date.now()}`,
      adminUsername: db.admin.username,
      action: 'MODIFICATION_MOT_DE_PASSE',
      entityType: 'security',
      entityId: 'admin',
      entityName: 'Compte Administrateur',
      oldValue: 'Ancien mot de passe sécurisé',
      adjustment: null,
      newValue: 'Nouveau mot de passe sécurisé configuré',
      reason: 'Mise à jour obligatoire du mot de passe initial',
      createdAt: new Date().toISOString(),
    });

    saveDatabase(db);
    res.json({ success: true, message: 'Mot de passe modifié avec succès.' });
  });

  // Admin Dashboard Statistics
  app.get('/api/admin/dashboard', verifyAdmin, (req, res) => {
    const results = computeResults();

    const uniqueIps = new Set(db.ballots.map((b) => b.ipFingerprint)).size;
    const blockedAttempts = db.securityRecords.reduce((acc, s) => (s.status === 'blocked' ? acc + s.attemptsCount : acc), 0);
    const candidateSelections = db.ballots.reduce((acc, b) => acc + b.candidateIds.length, 0);

    res.json({
      settings: db.settings,
      totalBallots: results.totalBallots,
      candidateSelections,
      uniqueIps,
      blockedAttempts,
      parties: results.parties,
      candidatesByParty: results.candidatesByParty,
      recentLogs: db.auditLogs.slice(0, 8),
      securityStats: {
        totalRecords: db.securityRecords.length,
        votedCount: db.securityRecords.filter((s) => s.status === 'voted').length,
        blockedCount: db.securityRecords.filter((s) => s.status === 'blocked').length,
      },
    });
  });

  // Adjust party or candidate votes manually (requires mandatory reason)
  app.post('/api/admin/adjust-votes', verifyAdmin, (req, res) => {
    const { type, entityId, adjustment, reason } = req.body;

    if (!reason || reason.trim().length < 3) {
      return res.status(400).json({ error: 'Le motif de modification est obligatoire (au moins 3 caractères).' });
    }

    const delta = Number(adjustment);
    if (isNaN(delta) || delta === 0) {
      return res.status(400).json({ error: 'Quantité d\'ajustement invalide.' });
    }

    if (type === 'party') {
      const party = db.parties.find((p) => p.id === entityId);
      if (!party) return res.status(404).json({ error: 'Liste non trouvée.' });

      const currentVal = party.manualVoteAdjustment || 0;
      const newVal = currentVal + delta;
      if (newVal < 0) {
        return res.status(400).json({ error: 'Le compteur ne peut pas devenir négatif.' });
      }

      party.manualVoteAdjustment = newVal;

      db.auditLogs.unshift({
        id: `log-${Date.now()}`,
        adminUsername: db.admin.username,
        action: delta > 0 ? 'AJOUT_VOIX_LISTE' : 'RETRAIT_VOIX_LISTE',
        entityType: 'party',
        entityId: party.id,
        entityName: party.name,
        oldValue: currentVal,
        adjustment: delta,
        newValue: newVal,
        reason: reason.trim(),
        createdAt: new Date().toISOString(),
      });

      saveDatabase(db);
      return res.json({ success: true, newValue: newVal, party });
    } else if (type === 'candidate') {
      const cand = db.candidates.find((c) => c.id === entityId);
      if (!cand) return res.status(404).json({ error: 'Candidat non trouvé.' });

      const currentVal = cand.manualVoteAdjustment || 0;
      const newVal = currentVal + delta;
      if (newVal < 0) {
        return res.status(400).json({ error: 'Le compteur ne peut pas devenir négatif.' });
      }

      cand.manualVoteAdjustment = newVal;

      db.auditLogs.unshift({
        id: `log-${Date.now()}`,
        adminUsername: db.admin.username,
        action: delta > 0 ? 'AJOUT_VOIX_CANDIDAT' : 'RETRAIT_VOIX_CANDIDAT',
        entityType: 'candidate',
        entityId: cand.id,
        entityName: `${cand.firstName} ${cand.lastName}`,
        oldValue: currentVal,
        adjustment: delta,
        newValue: newVal,
        reason: reason.trim(),
        createdAt: new Date().toISOString(),
      });

      saveDatabase(db);
      return res.json({ success: true, newValue: newVal, candidate: cand });
    }

    res.status(400).json({ error: 'Type invalide (party ou candidate).' });
  });

  // Update Party
  app.post('/api/admin/parties/update', verifyAdmin, (req, res) => {
    const { id, name, arabicName, listNumber, isPublic, logoUrl } = req.body;
    const party = db.parties.find((p) => p.id === id);
    if (!party) return res.status(404).json({ error: 'Liste non trouvée.' });

    const oldName = party.name;
    if (name) party.name = name;
    if (arabicName) party.arabicName = arabicName;
    if (listNumber !== undefined) party.listNumber = Number(listNumber);
    if (isPublic !== undefined) party.isPublic = Boolean(isPublic);
    if (logoUrl) party.logoUrl = logoUrl;

    db.auditLogs.unshift({
      id: `log-${Date.now()}`,
      adminUsername: db.admin.username,
      action: 'MODIFICATION_LISTE',
      entityType: 'party',
      entityId: party.id,
      entityName: party.name,
      oldValue: oldName,
      adjustment: null,
      newValue: JSON.stringify({ name: party.name, isPublic: party.isPublic }),
      reason: 'Mise à jour des informations de la liste',
      createdAt: new Date().toISOString(),
    });

    saveDatabase(db);
    res.json({ success: true, party });
  });

  // Update or Add Candidate
  app.post('/api/admin/candidates/save', verifyAdmin, (req, res) => {
    const { id, partyId, firstName, lastName, arabicName, listPosition, profession, age, photoUrl } = req.body;

    if (id) {
      const cand = db.candidates.find((c) => c.id === id);
      if (!cand) return res.status(404).json({ error: 'Candidat introuvable.' });

      if (firstName) cand.firstName = firstName;
      if (lastName) cand.lastName = lastName;
      if (arabicName) cand.arabicName = arabicName;
      if (listPosition !== undefined) cand.listPosition = Number(listPosition);
      if (profession !== undefined) cand.profession = profession;
      if (age !== undefined) cand.age = Number(age);
      if (photoUrl) cand.photoUrl = photoUrl;

      db.auditLogs.unshift({
        id: `log-${Date.now()}`,
        adminUsername: db.admin.username,
        action: 'MODIFICATION_CANDIDAT',
        entityType: 'candidate',
        entityId: cand.id,
        entityName: `${cand.firstName} ${cand.lastName}`,
        oldValue: 'Informations précédentes',
        adjustment: null,
        newValue: `${cand.firstName} ${cand.lastName} (N° ${cand.listPosition})`,
        reason: 'Modification fiche candidat',
        createdAt: new Date().toISOString(),
      });

      saveDatabase(db);
      return res.json({ success: true, candidate: cand });
    } else {
      // New candidate
      const newCand: Candidate = {
        id: `${partyId}-${Date.now()}`,
        partyId,
        firstName: firstName || 'Nouveau',
        lastName: lastName || 'Candidat',
        arabicName: arabicName || '',
        listPosition: Number(listPosition) || db.candidates.filter((c) => c.partyId === partyId).length + 1,
        photoUrl: photoUrl || '/candidates/default.jpg',
        profession,
        age: age ? Number(age) : undefined,
        isActive: true,
        manualVoteAdjustment: 0,
        voteCount: 0,
      };

      db.candidates.push(newCand);

      db.auditLogs.unshift({
        id: `log-${Date.now()}`,
        adminUsername: db.admin.username,
        action: 'AJOUT_CANDIDAT',
        entityType: 'candidate',
        entityId: newCand.id,
        entityName: `${newCand.firstName} ${newCand.lastName}`,
        oldValue: null,
        adjustment: null,
        newValue: `Créé sous la liste ${partyId}`,
        reason: 'Ajout nouveau candidat',
        createdAt: new Date().toISOString(),
      });

      saveDatabase(db);
      return res.json({ success: true, candidate: newCand });
    }
  });

  // Delete candidate (soft or hard with confirmation)
  app.post('/api/admin/candidates/delete', verifyAdmin, (req, res) => {
    const { id } = req.body;
    const cand = db.candidates.find((c) => c.id === id);
    if (!cand) return res.status(404).json({ error: 'Candidat introuvable.' });

    cand.isActive = false;

    db.auditLogs.unshift({
      id: `log-${Date.now()}`,
      adminUsername: db.admin.username,
      action: 'SUPPRESSION_CANDIDAT',
      entityType: 'candidate',
      entityId: cand.id,
      entityName: `${cand.firstName} ${cand.lastName}`,
      oldValue: 'Actif',
      adjustment: null,
      newValue: 'Désactivé',
      reason: 'Suppression confirmée par administrateur',
      createdAt: new Date().toISOString(),
    });

    saveDatabase(db);
    res.json({ success: true });
  });

  // Security Panel: List IPs & statistics
  app.get('/api/admin/security', verifyAdmin, (req, res) => {
    res.json({
      ipProtectionEnabled: db.settings.ipProtectionEnabled,
      records: db.securityRecords,
      totalVotedIps: db.securityRecords.filter((s) => s.status === 'voted').length,
      totalBlockedAttempts: db.securityRecords.reduce((acc, s) => (s.status === 'blocked' ? acc + s.attemptsCount : acc), 0),
    });
  });

  // Unblock IP
  app.post('/api/admin/security/unblock', verifyAdmin, (req, res) => {
    const { ipFingerprint, reason } = req.body;
    if (!reason || reason.trim().length < 3) {
      return res.status(400).json({ error: 'Le motif de déblocage est obligatoire.' });
    }

    const rec = db.securityRecords.find((s) => s.ipFingerprint === ipFingerprint);
    if (rec) {
      rec.status = 'unblocked';
      rec.reason = reason;
    } else {
      db.securityRecords.push({
        ipFingerprint,
        firstSeen: new Date().toISOString(),
        lastAttempt: new Date().toISOString(),
        attemptsCount: 0,
        status: 'unblocked',
        reason,
      });
    }

    db.auditLogs.unshift({
      id: `log-${Date.now()}`,
      adminUsername: db.admin.username,
      action: 'DEBLOCAGE_IP',
      entityType: 'security',
      entityId: ipFingerprint.substring(0, 10) + '...',
      entityName: 'Empreinte IP anonymisée',
      oldValue: 'Bloqué',
      adjustment: null,
      newValue: 'Débloqué',
      reason: reason.trim(),
      createdAt: new Date().toISOString(),
    });

    saveDatabase(db);
    res.json({ success: true, message: 'Empreinte IP débloquée avec succès.' });
  });

  // Toggle IP Protection
  app.post('/api/admin/security/toggle-ip', verifyAdmin, (req, res) => {
    const { enabled } = req.body;
    db.settings.ipProtectionEnabled = Boolean(enabled);

    db.auditLogs.unshift({
      id: `log-${Date.now()}`,
      adminUsername: db.admin.username,
      action: 'MODIFICATION_SECURITE_IP',
      entityType: 'security',
      entityId: 'ip_protection',
      entityName: 'Protection Anti-Doublon IP',
      oldValue: !db.settings.ipProtectionEnabled,
      adjustment: null,
      newValue: db.settings.ipProtectionEnabled,
      reason: db.settings.ipProtectionEnabled ? 'Activation du filtrage par IP' : 'Désactivation du filtrage par IP',
      createdAt: new Date().toISOString(),
    });

    saveDatabase(db);
    res.json({ success: true, ipProtectionEnabled: db.settings.ipProtectionEnabled });
  });

  // Audit Logs with search & filter
  app.get('/api/admin/audit-logs', verifyAdmin, (req, res) => {
    const { query, entityType } = req.query;
    let logs = [...db.auditLogs];

    if (entityType && entityType !== 'all') {
      logs = logs.filter((l) => l.entityType === entityType);
    }

    if (query && typeof query === 'string') {
      const q = query.toLowerCase();
      logs = logs.filter(
        (l) =>
          l.entityName.toLowerCase().includes(q) ||
          l.action.toLowerCase().includes(q) ||
          l.reason.toLowerCase().includes(q)
      );
    }

    res.json(logs);
  });

  // Update General Settings & Results Publication
  app.post('/api/admin/settings', verifyAdmin, (req, res) => {
    const {
      name,
      municipality,
      wilaya,
      eventDate,
      welcomeTitleFr,
      welcomeTitleAr,
      publicResultsEnabled,
      resultsStatus,
      minCandidates,
      maxCandidates,
    } = req.body;

    if (name) db.settings.name = name;
    if (municipality) db.settings.municipality = municipality;
    if (wilaya) db.settings.wilaya = wilaya;
    if (eventDate) db.settings.eventDate = eventDate;
    if (welcomeTitleFr) db.settings.welcomeTitleFr = welcomeTitleFr;
    if (welcomeTitleAr) db.settings.welcomeTitleAr = welcomeTitleAr;
    if (publicResultsEnabled !== undefined) db.settings.publicResultsEnabled = Boolean(publicResultsEnabled);
    if (resultsStatus) db.settings.resultsStatus = resultsStatus;
    if (minCandidates) db.settings.minCandidates = Number(minCandidates);
    if (maxCandidates) db.settings.maxCandidates = Number(maxCandidates);

    db.auditLogs.unshift({
      id: `log-${Date.now()}`,
      adminUsername: db.admin.username,
      action: 'MODIFICATION_PARAMETRES',
      entityType: 'settings',
      entityId: 'general',
      entityName: 'Paramètres généraux',
      oldValue: 'Configuration précédente',
      adjustment: null,
      newValue: `Date: ${db.settings.eventDate}, Résultats publics: ${db.settings.publicResultsEnabled}, Statut: ${db.settings.resultsStatus}`,
      reason: 'Mise à jour des paramètres de la plateforme',
      createdAt: new Date().toISOString(),
    });

    saveDatabase(db);
    res.json({ success: true, settings: db.settings });
  });

  // Reset election data with safety confirmation
  app.post('/api/admin/reset-election', verifyAdmin, (req, res) => {
    const { confirmationPhrase, reason } = req.body;
    if (confirmationPhrase !== 'REINITIALISER') {
      return res.status(400).json({ error: 'Veuillez saisir exactement "REINITIALISER" pour confirmer.' });
    }

    const previousBallotCount = db.ballots.length;
    db.ballots = [];
    db.securityRecords = [];
    for (const p of db.parties) {
      p.manualVoteAdjustment = 0;
    }
    for (const c of db.candidates) {
      c.manualVoteAdjustment = 0;
    }

    db.auditLogs.unshift({
      id: `log-${Date.now()}`,
      adminUsername: db.admin.username,
      action: 'REINITIALISATION_ELECTION',
      entityType: 'database',
      entityId: 'all',
      entityName: 'Tous les bulletins et compteurs',
      oldValue: `${previousBallotCount} bulletins`,
      adjustment: -previousBallotCount,
      newValue: '0 bulletin',
      reason: reason || 'Réinitialisation complète ordonnée par l\'administrateur',
      createdAt: new Date().toISOString(),
    });

    saveDatabase(db);
    res.json({ success: true, message: 'La consultation a été réinitialisée avec succès.' });
  });

  // Export CSV
  app.get('/api/admin/export-csv', verifyAdmin, (req, res) => {
    const results = computeResults();
    let csv = 'Type,ID,Nom,Numero/Position,Voix/Bulletins,Pourcentage\n';

    for (const p of results.parties) {
      csv += `Liste,${p.id},"${p.name} - ${p.arabicName}",${p.listNumber},${p.ballotCount},${p.percentage}%\n`;
      const candList = results.candidatesByParty[p.id] || [];
      for (const c of candList) {
        csv += `Candidat,${c.id},"${c.firstName} ${c.lastName}",${c.listPosition},${c.voteCount},${c.percentage}%\n`;
      }
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=elections_seddouk_2026_${Date.now()}.csv`);
    res.send(csv);
  });

  // --- STATIC OR VITE MIDDLEWARE ---
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
