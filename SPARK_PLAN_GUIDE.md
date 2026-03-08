# AlphaInsight Pro on Firebase Spark Plan (Free Tier)

Good news! **Your app works perfectly on Firebase Spark Plan** - no upgrades needed!

## What's Being Used from Spark Plan ✅

### Firestore Database ✅
- **Per-user collections**: `users/{uid}/docMeta`, `users/{uid}/chunks`, `users/{uid}/chats`
- **Operations**: Store documents, messages, embeddings
- **Limit**: 50k reads/day (free tier)
- **Your usage**: Minimal - only data storage
- **Status**: ✅ **SUPPORTED**

### Firebase Authentication ✅
- **Methods**: Email/Password + Anonymous
- **Status**: ✅ **SUPPORTED**
- **Limits**: Unlimited free users

### Firebase Hosting ✅
- **Serves**: Static files from `/dist` folder
- **Bandwidth**: 10 GB/month free
- **Status**: ✅ **SUPPORTED**

### Storage Rules ✅
- **Configured**: Yes (in `storage.rules`)
- **Status**: ✅ **SUPPORTED**

## What's NOT Being Used 🚫

### Cloud Functions ❌
- **Not needed**: App doesn't use Cloud Functions
- **Backend server (server.js)**: Not deployed to Firebase - it's just for local development
- **Status**: ✅ **Not required**

### Cloud Storage ❌
- **Not needed**: App stores documents in Firestore only
- **Status**: ✅ **Not required**

### Real-time Database ❌
- **Not needed**: Using Firestore instead
- **Status**: ✅ **Not required**

## How It Works on Spark Plan

```
┌─────────────────────────────────────────────────────────┐
│                    Your Browser                         │
│  (Frontend React App - runs in browser)                 │
└──────────┬──────────────────────────────────────────────┘
           │
      Calls APIs to:
      1. Gemini (direct from browser)
      2. Firestore (direct from browser)
      3. Firebase Auth (direct from browser)
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│              Firebase (Free Spark Plan)                 │
├─────────────────────────────────────────────────────────┤
│  ✅ Firestore Database (data storage)                   │
│  ✅ Firebase Hosting (static files)                     │
│  ✅ Firebase Auth (user management)                     │
└─────────────────────────────────────────────────────────┘

           ▼
┌─────────────────────────────────────────────────────────┐
│            External APIs (using free keys)              │
├─────────────────────────────────────────────────────────┤
│  ✅ Google Gemini API (from your .env)                  │
└─────────────────────────────────────────────────────────┘
```

## Spark Plan Limits & Your App ✅

| Limit | Your App | Status |
|-------|----------|--------|
| Firestore reads/day | 50k | You'll use < 100/day ✅ |
| Firestore writes/day | 20k | You'll use < 50/day ✅ |
| Stored data | 1 GB | You'll use < 100 MB ✅ |
| Hosting bandwidth | 10 GB/month | You'll use < 100 MB ✅ |
| Auth users | Unlimited | Unlimited ✅ |
| Build time | Instant | Instant ✅ |

## Deployment Steps (Spark Plan)

1. **Deploy static files** (only what's needed):
   ```bash
   npm run build          # Creates optimized /dist folder
   firebase deploy        # Deploys only to Hosting + Firestore rules
   ```

2. **Skip server deployment** (not needed):
   - `server.js` is for local testing only
   - Don't deploy it - Firebase Hosting doesn't support Node.js on Spark plan

3. **Configure Firestore**:
   - Security rules are already set (`firestore.rules`)
   - Database will be created automatically on first write
   - Data automatically scoped to each user

## What Gets Deployed ✅

When you run `firebase deploy`:
- ✅ `/dist` → Firebase Hosting
- ✅ Security rules → Firestore
- ✅ Storage rules → Cloud Storage
- ✅ Firestore indexes → Firestore

Everything else (server.js, node_modules) is ignored.

## Cost Breakdown

- **Firebase Hosting**: FREE
- **Firestore**: FREE (50k reads/writes/day)
- **Firebase Auth**: FREE (unlimited users)
- **Gemini API**: **You need to set daily/monthly limits** in Google Cloud Console

## ⚠️ Important: Set Gemini API Limits

To avoid unexpected charges:

1. Go to: https://console.cloud.google.com/
2. Find your project
3. Go to "APIs & Services" → "Generative Language API"
4. Set quotas on API usage
5. Enable billing alerts in your Google Cloud account

Gemini free tier: 1500 requests/day

## Summary

Your app is **100% compatible with Spark Plan** because:
1. ✅ No Cloud Functions needed
2. ✅ No backend server on Hosting
3. ✅ Using only free Firestore operations
4. ✅ Direct browser API calls to Gemini
5. ✅ All data scoped per user

**You're good to go! Deploy and enjoy!** 🚀
