'use client';

import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const APP_NAME = 'ausbug-lts-review';

const app = getApps().some((candidate) => candidate.name === APP_NAME)
  ? getApp(APP_NAME)
  : initializeApp({
      apiKey: 'AIzaSyAsij1EpdPpuhsfcClqAnBFshHfGd6WeJo',
      authDomain: 'cyaroutes.firebaseapp.com',
      projectId: 'cyaroutes',
      storageBucket: 'cyaroutes.firebasestorage.app',
      messagingSenderId: '601003510442',
      appId: '1:601003510442:web:a91daf9016922656a89ed3',
    }, APP_NAME);

export const ausbugAuth = getAuth(app);
export const reviewAuth = ausbugAuth;
