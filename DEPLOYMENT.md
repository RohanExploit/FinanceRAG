# AlphaInsight Pro - Deployment Guide

## Prerequisites

1. **Node.js** (v18+) installed
2. **Firebase Account** with a project created
3. **Google Cloud API Key** with Gemini API enabled
4. **Firebase CLI** installed: `npm install -g firebase-tools`

## Setup Instructions

### 1. Clone & Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Then edit `.env` with:

#### Firebase Configuration
- Visit https://console.firebase.google.com/
- Create a new project or select existing
- Go to Project Settings → Service Accounts
- Copy your Firebase config values (API Key, Auth Domain, Project ID, etc.)

#### Gemini API Key
- Visit https://aistudio.google.com/app/apikey
- Create a new API key
- Add it to `VITE_GEMINI_API_KEY` in `.env`

### 3. Security Rules Setup

Ensure your Firestore and Storage security rules are properly configured:

**Firestore Rules** (firestore.rules):
- Users can only access their own documents and chats
- Authenticated users can read/write their collections

**Storage Rules** (storage.rules):
- Users can only upload/download their own files

### 4. Build for Production

```bash
npm run build
```

This creates an optimized `dist/` folder with:
- Code splitting for faster loading
- Minified assets
- Optimized chunks for common dependencies

### 5. Deploy to Firebase

First, initialize Firebase (if not already done):
```bash
firebase login
firebase init
```

Then deploy:
```bash
npm run deploy
```

Or manually:
```bash
npm run build
firebase deploy
```

## Deployment Checklist

- [ ] All environment variables set in `.env`
- [ ] Firebase project created and configured
- [ ] Gemini API enabled on Google Cloud
- [ ] Firestore database created
- [ ] Security rules deployed
- [ ] Build completes without errors: `npm run build`
- [ ] No warnings about missing environment variables
- [ ] dist/ folder generated successfully
- [ ] Firebase deploy succeeds: `firebase deploy`

## Local Testing

Run locally with both frontend and backend:

```bash
npm run dev
```

This starts:
- **Backend**: Express server on port 3001 with Genkit endpoints
- **Frontend**: Vite dev server on port 5173

## Production Environment Variables

Required variables for deployment:
- `VITE_FIREBASE_API_KEY` - Firebase API key
- `VITE_FIREBASE_AUTH_DOMAIN` - Firebase auth domain
- `VITE_FIREBASE_PROJECT_ID` - Firebase project ID
- `VITE_FIREBASE_STORAGE_BUCKET` - Firebase storage bucket
- `VITE_FIREBASE_MESSAGING_SENDER_ID` - Firebase messaging sender ID
- `VITE_FIREBASE_APP_ID` - Firebase app ID
- `VITE_GEMINI_API_KEY` - Google Gemini API key

## Troubleshooting

### "Missing VITE_GEMINI_API_KEY" Error
- Ensure `.env` file exists in project root
- Verify `VITE_GEMINI_API_KEY` is set
- Restart dev server: `npm run dev`

### Firebase Authentication Failing
- Go to Firebase Console → Authentication → Sign-in method
- Enable "Email/Password" and "Anonymous" sign-in methods
- Verify Firestore security rules allow the operations

### Large File Upload Issues
- Max file size is 25 MB
- Ensure your internet connection is stable
- Check browser console for specific errors

### Firestore Rate Limiting
- Free tier has query limits
- Implement pagination or upgrade to Blaze plan
- Consider caching strategies

## Performance Optimization

The build includes:
- **Code Splitting**: Separate bundles for PDF.js, Firebase, and Gemini libraries
- **Minification**: Terser is used for JS optimization
- **Caching Headers**: Assets cached for 1 year, HTML for 1 hour
- **Sourcemaps Disabled**: Production builds are smaller

## Support & Documentation

- **Firebase Docs**: https://firebase.google.com/docs
- **Gemini API**: https://ai.google.dev/docs
- **Firestore**: https://firebase.google.com/docs/firestore
- **Vite**: https://vitejs.dev/guide/
