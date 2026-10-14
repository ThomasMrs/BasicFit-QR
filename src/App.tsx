import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import QRCode from 'qrcode'
import {
  ArrowRight,
  BadgeCheck,
  Check,
  Dumbbell,
  Eye,
  EyeOff,
  Hash,
  KeyRound,
  LockKeyhole,
  LogOut,
  QrCode,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserRound,
} from 'lucide-react'
import type { Session, User } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import {
  emptyMemberData,
  type MemberData,
} from './lib/vault'

type Screen = 'config' | 'loading' | 'auth' | 'dashboard'
type AuthMode = 'login' | 'signup'
type Flash = { kind: 'success' | 'error' | 'info'; message: string } | null

const EMPTY_FORM = emptyMemberData()

function friendlyError(message: string): string {
  if (message.includes('Invalid login credentials')) return 'Adresse e-mail ou mot de passe incorrect.'
  if (message.includes('Email not confirmed')) return 'Confirme ton adresse e-mail depuis le lien reçu.'
  if (message.includes('User already registered')) return 'Cette adresse e-mail possède déjà un compte. Connecte-toi.'
  if (message.includes('Failed to fetch')) return 'Connexion impossible. Vérifie la configuration Supabase et ta connexion.'
  return message
}

function App() {
  const [screen, setScreen] = useState<Screen>(isSupabaseConfigured ? 'loading' : 'config')
  const [user, setUser] = useState<User | null>(null)
  const [member, setMember] = useState<MemberData>(EMPTY_FORM)
  const [flash, setFlash] = useState<Flash>(null)
  const [busy, setBusy] = useState(false)
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)

  // Dynamic QR State
  const [dynamicQr, setDynamicQr] = useState<string | null>(null)
  const [dynamicCode, setDynamicCode] = useState<string>('')
  const [progress, setProgress] = useState(0)

  const memberInitials = useMemo(() => {
    const parts = member.name.trim().split(/\s+/).filter(Boolean)
    return parts.length ? parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase() : 'BF'
  }, [member.name])

  const inspectSession = useCallback(async (session: Session | null) => {
    if (!session || !supabase) {
      setUser(null)
      setMember(EMPTY_FORM)
      setScreen(isSupabaseConfigured ? 'auth' : 'config')
      return
    }

    setUser(session.user)
    setScreen('loading')
    const { data, error } = await supabase
      .from('member_vault')
      .select('user_id, ciphertext, updated_at')
      .eq('user_id', session.user.id)
      .maybeSingle()

    if (error) {
      setFlash({ kind: 'error', message: `Impossible de lire les données : ${friendlyError(error.message)}` })
      setScreen('auth')
      return
    }

    if (data) {
      try {
        const parsed = JSON.parse(data.ciphertext) as MemberData
        setMember({ ...EMPTY_FORM, ...parsed })
        if (parsed.deviceId) {
          try { localStorage.setItem('basicpass_device_id', parsed.deviceId) } catch {}
        }
      } catch {
        setMember(EMPTY_FORM)
      }
      setLastSavedAt(data.updated_at ?? null)
    } else {
      setMember(EMPTY_FORM)
      setLastSavedAt(null)
    }

    setScreen('dashboard')
  }, [])

  useEffect(() => {
    if (!supabase) return
    let active = true
    const sync = async (session: Session | null) => {
      if (active) await inspectSession(session)
    }
    void supabase.auth.getSession().then(({ data }) => sync(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      void sync(session)
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [inspectSession])

  // ── Live GM2 Protocol ──
  useEffect(() => {
    if (!member.memberNumber.trim()) {
      setDynamicQr(null)
      setDynamicCode('')
      return
    }

    const cardNr = member.memberNumber.trim()
    const guid = member.guid?.trim() || 'ECQ'

    let deviceId = member.deviceId?.trim() || ''
    if (!deviceId) {
      try {
        deviceId = localStorage.getItem('basicpass_device_id') || ''
        if (!deviceId) {
          deviceId = crypto.randomUUID()
          localStorage.setItem('basicpass_device_id', deviceId)
        }
      } catch {
        deviceId = 'fallback-device-id'
      }
    }

    let cancelled = false
    let rafId: number
    let intervalId: number

    const generate = async () => {
      const iat = Math.floor(Date.now() / 1000)
      const input = cardNr + guid + iat + deviceId
      const buf = new TextEncoder().encode(input)
      const hash = await crypto.subtle.digest('SHA-256', buf)
      const hex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
      const checksum = hex.slice(-8).toUpperCase()
      const code = `GM2:${cardNr}:${guid}:${iat}:${checksum}`

      if (cancelled) return
      setDynamicCode(code)
      try {
        const dataUrl = await QRCode.toDataURL(code, {
          errorCorrectionLevel: 'M',
          margin: 2,
          width: 360,
          color: { dark: '#171717', light: '#ffffff' },
        })
        if (!cancelled) setDynamicQr(dataUrl)
      } catch {
        if (!cancelled) setDynamicQr(null)
      }
    }

    void generate()
    intervalId = window.setInterval(() => { void generate() }, 5000)

    const startTime = Date.now()
    const duration = 5000
    const animate = () => {
      if (cancelled) return
      const elapsed = (Date.now() - startTime) % duration
      setProgress((elapsed / duration) * 100)
      rafId = requestAnimationFrame(animate)
    }
    rafId = requestAnimationFrame(animate)

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      window.clearInterval(intervalId)
    }
  }, [member.memberNumber, member.guid, member.deviceId])

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setFlash(null)
    try {
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email: authEmail.trim(), password: authPassword })
        if (error) throw error
        if (!data.session) {
          setFlash({ kind: 'info', message: 'Compte créé. Confirme ton e-mail, puis connecte-toi.' })
        } else {
          setFlash({ kind: 'success', message: 'Compte créé avec succès !' })
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: authEmail.trim(), password: authPassword })
        if (error) throw error
      }
    } catch (error) {
      setFlash({ kind: 'error', message: friendlyError(error instanceof Error ? error.message : 'Une erreur est survenue.') })
    } finally {
      setBusy(false)
    }
  }

  async function saveMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !user) return
    if (member.name.trim().length > 80 || member.memberNumber.trim().length > 40 || member.club.trim().length > 100) {
      setFlash({ kind: 'error', message: 'Un champ dépasse la longueur autorisée.' })
      return
    }
    if (!member.memberNumber.trim()) {
      setFlash({ kind: 'error', message: 'Ton numéro de membre est requis pour générer le QR code.' })
      return
    }

    setBusy(true)
    setFlash(null)
    try {
      const nextData: MemberData = {
        name: member.name.trim(),
        memberNumber: member.memberNumber.trim(),
        club: member.club.trim(),
        guid: member.guid.trim() || 'ECQ',
        deviceId: member.deviceId.trim(),
        qrSource: 'text',
        qrPayload: dynamicCode,
        imagePath: null,
        imageType: null,
      }
      if (nextData.deviceId) {
        try { localStorage.setItem('basicpass_device_id', nextData.deviceId) } catch {}
      }
      const { data, error } = await supabase.from('member_vault').upsert({
        user_id: user.id,
        salt: '-',
        iv: '-',
        ciphertext: JSON.stringify(nextData),
      }, { onConflict: 'user_id' }).select('updated_at').single()
      if (error) throw error

      setMember(nextData)
      setLastSavedAt(data.updated_at ?? null)
      setFlash({ kind: 'success', message: 'Ton espace membre est enregistré.' })
    } catch (error) {
      setFlash({ kind: 'error', message: `Enregistrement impossible : ${friendlyError(error instanceof Error ? error.message : 'Vérifie Supabase.')}` })
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    if (!supabase) return
    setMember(EMPTY_FORM)
    setDynamicQr(null)
    setDynamicCode('')
    setProgress(0)
    const { error } = await supabase.auth.signOut()
    if (error) setFlash({ kind: 'error', message: friendlyError(error.message) })
  }

  if (screen === 'config') return <ConfigurationScreen />
  if (screen === 'loading') return <LoadingScreen />
  if (screen === 'auth') {
    return <AuthScreen
      mode={authMode}
      setMode={(mode) => { setAuthMode(mode); setFlash(null) }}
      email={authEmail}
      setEmail={setAuthEmail}
      password={authPassword}
      setPassword={setAuthPassword}
      showPassword={showPassword}
      togglePassword={() => setShowPassword((value) => !value)}
      busy={busy}
      flash={flash}
      onSubmit={submitAuth}
    />
  }

  const lastSaved = lastSavedAt ? new Date(lastSavedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null

  return (
    <main className="dashboard-page">
      <div className="dashboard-shell">
        <header className="topbar">
          <a className="brand" href="#top" aria-label="Basic Pass, accueil">
            <span className="brand-mark"><Dumbbell size={20} strokeWidth={2.7} /></span>
            <span className="brand-copy"><strong>basic<span>pass</span></strong><small>ESPACE PERSONNEL</small></span>
          </a>
          <div className="topbar-actions">
            <span className="account-chip"><span className="online-dot" />{user?.email}</span>
            <button className="icon-button logout-button" onClick={signOut} title="Se déconnecter" aria-label="Se déconnecter"><LogOut size={17} /></button>
          </div>
        </header>

        <section className="welcome-row" id="top">
          <div>
            <div className="eyebrow"><span className="eyebrow-line" /> TON ESPACE MEMBRE</div>
            <h1>Prêt à <span>bouger.</span></h1>
            <p>Ton accès Basic-Fit réuni dans un espace privé, simple et rapide.</p>
          </div>
        </section>

        {flash && <div className={`flash flash-${flash.kind}`} role="status"><span className="flash-icon">{flash.kind === 'success' ? <Check size={16} /> : flash.kind === 'error' ? '!' : <ShieldCheck size={16} />}</span>{flash.message}</div>}

        <section className="member-layout">
          <div className="member-column">
            <div className="section-heading"><div><span className="section-kicker">TON PROFIL</span><h2>Carte de membre</h2></div><span className="member-avatar">{memberInitials}</span></div>

            <form className="profile-form" onSubmit={saveMember}>
              <div className="form-grid">
                <label className="field"><span>Nom affiché</span><div className="input-wrap"><UserRound size={17} /><input value={member.name} onChange={(event) => setMember({ ...member, name: event.target.value })} placeholder="Ex. Alex Martin" maxLength={80} autoComplete="name" /></div></label>
                <label className="field"><span>Numéro d'adhérent <button type="button" className="inline-eye" onClick={() => setShowDetails(!showDetails)} aria-label={showDetails ? 'Masquer le numéro' : 'Afficher le numéro'}>{showDetails ? <EyeOff size={14} /> : <Eye size={14} />}</button></span><div className="input-wrap"><KeyRound size={17} /><input value={member.memberNumber} onChange={(event) => setMember({ ...member, memberNumber: event.target.value })} placeholder="Ex. V010476970" maxLength={40} autoComplete="off" type={showDetails ? 'text' : 'password'} /></div></label>
                <label className="field"><span>Code GUID / Club <em>DÉFAUT: ECQ</em></span><div className="input-wrap"><Hash size={17} /><input value={member.guid} onChange={(event) => setMember({ ...member, guid: event.target.value })} placeholder="ECQ" maxLength={10} autoComplete="off" /></div></label>
                <label className="field"><span>Salle habituelle <em>FACULTATIF</em></span><div className="input-wrap"><Dumbbell size={17} /><input value={member.club} onChange={(event) => setMember({ ...member, club: event.target.value })} placeholder="Ex. Paris République" maxLength={100} /></div></label>
                <label className="field field-full"><span>Device ID (Basic-Fit) <em>REQUIS POUR LES TOURNIQUETS</em></span><div className="input-wrap"><Smartphone size={17} /><input value={member.deviceId} onChange={(event) => setMember({ ...member, deviceId: event.target.value })} placeholder="Ex. b7e0a3e8-1edf-4e6c-b5d3-4ff2b1189c1e" maxLength={100} autoComplete="off" /></div></label>
              </div>

              <div className="form-separator" />
              <div className="qr-form-heading"><div><span className="section-kicker">TON QR CODE</span><h3>Génération automatique GM2</h3></div><QrCode size={21} /></div>
              <p className="field-note" style={{ marginTop: '-8px', marginBottom: '16px' }}>
                <Sparkles size={14} /> Ton QR code est calculé via le protocole officiel (GM2 avec signature SHA-256) et mis à jour toutes les 5 secondes.
              </p>

              <button className="save-button" type="submit" disabled={busy}>{busy ? <span className="spinner" /> : <><span>Enregistrer mon espace</span><ArrowRight size={18} /></>}</button>
            </form>

            <div className="profile-footnote"><BadgeCheck size={16} /><span>{lastSaved ? `Dernière sauvegarde le ${lastSaved}` : 'Ton profil est visible uniquement quand tu es connecté.'}</span></div>
          </div>

          <aside className="pass-column">
            <div className="pass-card">
              <div className="pass-card-top"><div><span className="pass-overline">BASIC-FIT</span><strong>MEMBER PASS</strong></div><span className="pass-brand-icon"><Dumbbell size={17} /></span></div>
              <div className="pass-divider"><span /></div>
              <div className="qr-stage">
                {member.memberNumber.trim() && dynamicQr ? (
                  <div className="live-qr">
                    <span className="live-label">Live</span>
                    <img className="qr-image" src={dynamicQr} alt="QR code dynamique" />
                    <span className="live-code">{dynamicCode}</span>
                    <div className="progress-wrap">
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${progress}%` }} />
                      </div>
                      <div className="progress-label">
                        <span>Prochain refresh</span>
                        <span>{(5 - (progress / 100) * 5).toFixed(1)}s</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="qr-placeholder"><span className="qr-placeholder-icon"><QrCode size={36} /></span><strong>Ton QR apparaîtra ici</strong><span>Renseigne ton numéro d'adhérent pour le générer</span></div>
                )}
              </div>
              <div className="pass-person"><span className="pass-initials">{memberInitials}</span><div className="pass-person-copy"><span>MEMBRE</span><strong>{member.name || 'Ton nom'}</strong><small>{showDetails && member.memberNumber ? member.memberNumber : member.memberNumber ? `•••• ${member.memberNumber.slice(-4)}` : 'Numéro non renseigné'}</small></div><span className="pass-check"><Check size={15} /></span></div>
              <div className="pass-bottom"><span><span className="online-dot" /> ESPACE PERSONNEL</span><span>NO. {member.memberNumber ? member.memberNumber.slice(-4) : '——'}</span></div>
            </div>

            <div className="expiry-note"><Sparkles size={15} /><span>Un QR Basic-Fit peut expirer. Pour l'entrée, utilise le QR à jour fourni par l'application officielle.</span></div>
          </aside>
        </section>

        <footer className="dashboard-footer"><span>basicpass <i>·</i> TON ACCÈS, EN TOUTE SIMPLICITÉ</span><button onClick={signOut}>Se déconnecter <LogOut size={14} /></button></footer>
      </div>
    </main>
  )
}

function Brand() {
  return <div className="auth-brand"><span className="brand-mark"><Dumbbell size={21} strokeWidth={2.7} /></span><span className="brand-copy"><strong>basic<span>pass</span></strong><small>ESPACE PERSONNEL</small></span></div>
}

function AuthScreen(props: {
  mode: AuthMode; setMode: (mode: AuthMode) => void; email: string; setEmail: (value: string) => void
  password: string; setPassword: (value: string) => void; showPassword: boolean; togglePassword: () => void
  busy: boolean; flash: Flash; onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const signup = props.mode === 'signup'
  return <main className="gate-page"><div className="gate-layout"><section className="gate-story"><Brand /><div className="story-copy"><span className="eyebrow"><span className="eyebrow-line" /> TON PASS. TON RYTHME.</span><h1>La salle t'attend.<br /><span>Ton QR aussi.</span></h1><p>Un espace membre épuré pour garder tes informations Basic-Fit sous la main.</p><div className="story-stamp"><span><ShieldCheck size={17} /></span><div><strong>Connexion sécurisée</strong><small>Tes données sont protégées par ton compte.</small></div></div></div><div className="story-fade-mark">B.</div><div className="story-bottom">UN ESPACE PERSONNEL <i>·</i> UNE INTERFACE SANS FIORITURES</div></section>
    <section className="gate-panel"><div className="gate-card"><div className="mobile-brand"><Brand /></div><div className="panel-eyebrow">{signup ? 'TON ESPACE PERSONNEL' : 'BON RETOUR'}</div><h2>{signup ? 'Créer mon espace' : 'Se connecter'}</h2><p className="gate-subtitle">{signup ? 'Quelques instants pour créer ton espace membre.' : 'Retrouve ton QR et tes informations de membre.'}</p>
      {props.flash && <div className={`flash flash-${props.flash.kind}`} role="status">{props.flash.message}</div>}
      <form className="gate-form" onSubmit={props.onSubmit}>
        <label className="field"><span>Adresse e-mail</span><div className="input-wrap"><UserRound size={17} /><input type="email" value={props.email} onChange={(event) => props.setEmail(event.target.value)} placeholder="toi@exemple.fr" autoComplete="email" required /></div></label>
        <label className="field"><span>Mot de passe du compte</span><div className="input-wrap"><LockKeyhole size={17} /><input type={props.showPassword ? 'text' : 'password'} value={props.password} onChange={(event) => props.setPassword(event.target.value)} placeholder="Au moins 8 caractères" minLength={8} autoComplete={signup ? 'new-password' : 'current-password'} required /><button type="button" className="password-toggle" onClick={props.togglePassword} aria-label={props.showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>{props.showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
        <button className="save-button gate-submit" disabled={props.busy}>{props.busy ? <span className="spinner" /> : <><span>{signup ? 'Créer mon compte' : 'Accéder à mon espace'}</span><ArrowRight size={18} /></>}</button>
      </form>
      <div className="gate-switch">{signup ? 'Tu as déjà un compte ?' : 'Pas encore de compte ?'} <button onClick={() => props.setMode(signup ? 'login' : 'signup')}>{signup ? 'Se connecter' : 'Créer un compte'}</button></div>
      <div className="gate-assurance"><ShieldCheck size={16} /><span>Ton mot de passe Basic-Fit n'est jamais demandé ni enregistré ici.</span></div>
    </div><div className="gate-panel-bottom">© BASIC PASS <span>·</span> ESPACE PRIVÉ</div></section></div></main>
}

function ConfigurationScreen() {
  return <main className="vault-gate-page"><div className="vault-gate-card config-card"><Brand /><span className="vault-big-icon"><ShieldCheck size={25} /></span><span className="panel-eyebrow">CONFIGURATION</span><h1>Relier ton espace</h1><p>Ajoute les identifiants publics de ton projet Supabase, puis applique la migration SQL fournie dans le dépôt.</p><ol className="config-steps"><li><span>1</span><div><strong>Créer un projet Supabase</strong><small>Récupère l'URL du projet et sa clé publishable.</small></div></li><li><span>2</span><div><strong>Configurer l'application</strong><small>Copie <code>.env.example</code> vers <code>.env.local</code> et renseigne les deux valeurs.</small></div></li><li><span>3</span><div><strong>Créer la base de données</strong><small>Exécute la migration SQL du dossier <code>supabase/migrations</code>.</small></div></li></ol><div className="config-warning"><ShieldCheck size={16} /><span>N'ajoute jamais une clé <code>secret</code> ou <code>service_role</code> dans l'application.</span></div></div></main>
}

function LoadingScreen() {
  return <main className="loading-page"><Brand /><span className="spinner spinner-dark" /><p>Ouverture de ton espace privé…</p></main>
}

export default App