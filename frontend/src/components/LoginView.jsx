// src/components/LoginView.jsx
import { GoogleLogin } from '@react-oauth/google';
import { api } from '../api';

export default function LoginView({ onSignedIn, error }) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="app__brand" style={{ justifyContent: 'center', marginBottom: 18 }}>
          <span className="app__brand-dot" />
          HumanVerify
        </div>
        <p className="panel__hint" style={{ textAlign: 'center', marginBottom: 20 }}>
          Sign in with Google to upload, report, and appeal content under your own identity.
        </p>

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <GoogleLogin
            onSuccess={async (credentialResponse) => {
              try {
                const user = await api.signInWithGoogle(credentialResponse.credential);
                onSignedIn(user);
              } catch (err) {
                onSignedIn(null, err.message);
              }
            }}
            onError={() => onSignedIn(null, 'Google sign-in failed. Please try again.')}
          />
        </div>

        {error && <div className="alert alert--error" style={{ marginTop: 16 }}>{error}</div>}
      </div>
    </div>
  );
}
