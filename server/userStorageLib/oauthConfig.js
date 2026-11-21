// 🔌 Külső tárhely — az OAuth-szolgáltatók konfigurációja (env-kapuzott; a userStorage.js modulcsaládja).
// ───────────────────────────────────────────────────────── OAuth-konfiguráció
const OAUTH = {
  gdrive: {
    label: 'Google Drive',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    clientId: () => process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    extraAuth: { access_type: 'offline', prompt: 'consent' },
  },
  dropbox: {
    label: 'Dropbox',
    authUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    scope: 'files.metadata.read files.content.read',
    clientId: () => process.env.DROPBOX_APP_KEY,
    clientSecret: () => process.env.DROPBOX_APP_SECRET,
    extraAuth: { token_access_type: 'offline' },
  },
  onedrive: {
    label: 'OneDrive',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    // olvasás + feltöltés + offline-refresh (a refresh_token-hez)
    scope: 'Files.ReadWrite offline_access',
    clientId: () => process.env.MS_OAUTH_CLIENT_ID,
    clientSecret: () => process.env.MS_OAUTH_CLIENT_SECRET,
    extraAuth: { response_mode: 'query', prompt: 'consent' },
  },
};

function oauthConfigured(provider) {
  const p = OAUTH[provider];
  return !!(p && p.clientId() && p.clientSecret());
}

module.exports = { OAUTH, oauthConfigured };
