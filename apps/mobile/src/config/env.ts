

const DEFAULT_API_URL = 'http://localhost:8080/api/v1';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL;

export const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '';

export const IS_DEV = typeof __DEV__ !== 'undefined' ? __DEV__ : true;

// console.log(GOOGLE_CLIENT_ID);
//   console.log(API_URL);
