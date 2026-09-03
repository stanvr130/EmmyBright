// src/config/env.js
import dotenv from 'dotenv';
dotenv.config();

export const JWT_SECRET = process.env.JWT_SECRET || process.env.ACCESS_TOKEN_SECRET || 'super_secret_lafamilia_key_123';
export const ACCESS_TOKEN_SECRET = JWT_SECRET;

export const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.REFRESH_TOKEN_SECRET || 'super_secret_lafamilia_refresh_key_456';
export const REFRESH_TOKEN_SECRET = JWT_REFRESH_SECRET;