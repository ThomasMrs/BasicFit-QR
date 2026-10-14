import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import QRCode from 'qrcode'
import {
  ArrowRight,
  BadgeCheck,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Dumbbell,
  Eye,
  EyeOff,
  Hash,
  HelpCircle,
  Info,
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

  // Device ID Guide State
  const [showGuide, setShowGuide] = useState(false)
  const [guideTab, setGuideTab] = useState<'ios' | 'android' | 'json'>('ios')
  const [copiedExample, setCopiedExample] = useState(false)

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
            <h1>Ton pass. <span>Ton rythme.</span></h1>
            <p>Ton accès Basic-Fit, toujours à portée de main.</p>
          </div>
          <span className="welcome-status"><ShieldCheck size={15} /> Ton espace privé</span>
        </section>

        {flash && <div className={`flash flash-${flash.kind}`} role="status"><span className="flash-icon">{flash.kind === 'success' ? <Check size={16} /> : flash.kind === 'error' ? '!' : <ShieldCheck size={16} />}</span>{flash.message}</div>}

        <section className="member-layout">
          <aside className="pass-column" id="pass" aria-labelledby="pass-heading">
            <div className="pass-section-heading">
              <div><span className="section-kicker">TON ACCÈS</span><h2 id="pass-heading">Mon pass</h2></div>
              <span className="pass-auto"><Sparkles size={11} /> Mise à jour auto</span>
            </div>
            <div className="pass-card">
              <div className="pass-card-top"><div><span className="pass-overline">BASIC-FIT</span><strong>Pass personnel</strong></div><span className="pass-brand-icon"><Dumbbell size={17} /></span></div>
              <div className="pass-divider"><span /></div>
              <div className="qr-stage">
                {member.memberNumber.trim() && dynamicQr ? (
                  <div className="live-qr">
                    <span className="live-label">En direct</span>
                    <img className="qr-image" src={dynamicQr} alt="QR code dynamique" />
                    <span className="live-code">{dynamicCode}</span>
                    <div className="progress-wrap">
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${progress}%` }} />
                      </div>
                      <div className="progress-label">
                        <span>Actualisation du QR</span>
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

          <div className="member-column" id="profile" aria-labelledby="profile-heading">
            <div className="section-heading"><div><span className="section-kicker">LES ESSENTIELS</span><h2 id="profile-heading">Mon profil</h2></div><span className="member-avatar">{memberInitials}</span></div>
            <p className="profile-description">Tes informations de membre, réunies au même endroit.</p>

            <form className="profile-form" onSubmit={saveMember}>
              <div className="form-grid">
                <label className="field"><span>Nom affiché</span><div className="input-wrap"><UserRound size={17} /><input value={member.name} onChange={(event) => setMember({ ...member, name: event.target.value })} placeholder="Ton nom" maxLength={80} autoComplete="name" /></div></label>
                <label className="field"><span>Numéro d'adhérent <button type="button" className="inline-eye" onClick={() => setShowDetails(!showDetails)} aria-label={showDetails ? 'Masquer le numéro' : 'Afficher le numéro'}>{showDetails ? <EyeOff size={14} /> : <Eye size={14} />}</button></span><div className="input-wrap"><KeyRound size={17} /><input value={member.memberNumber} onChange={(event) => setMember({ ...member, memberNumber: event.target.value })} placeholder="Ex. V010476970" maxLength={40} autoComplete="off" type={showDetails ? 'text' : 'password'} /></div></label>
                <label className="field"><span>Code GUID / Club <em>DÉFAUT: ECQ</em></span><div className="input-wrap"><Hash size={17} /><input value={member.guid} onChange={(event) => setMember({ ...member, guid: event.target.value })} placeholder="ECQ" maxLength={10} autoComplete="off" /></div></label>
                <label className="field"><span>Salle habituelle <em>FACULTATIF</em></span><div className="input-wrap"><Dumbbell size={17} /><input value={member.club} onChange={(event) => setMember({ ...member, club: event.target.value })} placeholder="Ex. Paris République" maxLength={100} /></div></label>
                <label className="field field-full">
                  <span className="field-label-row">
                    <span>Device ID (Basic-Fit) <em>REQUIS POUR LES TOURNIQUETS</em></span>
                    <button
                      type="button"
                      className="guide-trigger-btn"
                      onClick={() => setShowGuide(!showGuide)}
                      aria-expanded={showGuide}
                      title="Comment trouver le Device ID ?"
                    >
                      <HelpCircle size={13} />
                      <span>{showGuide ? 'Masquer le guide' : 'Comment le trouver ?'}</span>
                      {showGuide ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                  </span>
                  <div className="input-wrap">
                    <Smartphone size={17} />
                    <input
                      value={member.deviceId}
                      onChange={(event) => setMember({ ...member, deviceId: event.target.value })}
                      placeholder="Ex. b7e0a3e8-1edf-4e6c-b5d3-4ff2b1189c1e"
                      maxLength={100}
                      autoComplete="off"
                    />
                  </div>
                </label>

                {showGuide && (
                  <div className="guide-card">
                    <div className="guide-header">
                      <div className="guide-title">
                        <Info size={16} />
                        <strong>Comment obtenir son Device ID ?</strong>
                      </div>
                      <span className="guide-badge">Tutoriel</span>
                    </div>

                    <p className="guide-lead">
                      Ce numéro <strong>n'apparaît pas dans les réglages système de votre téléphone</strong> (IMEI ou numéro de série) car Apple et Google interdisent aux applications d'accéder aux identifiants matériels. Il s'agit d'un identifiant généré par l'application <strong>Basic-Fit</strong> et associé à votre compte.
                    </p>

                    <div className="guide-tabs">
                      <button
                        type="button"
                        className={`guide-tab ${guideTab === 'ios' ? 'active' : ''}`}
                        onClick={() => setGuideTab('ios')}
                      >
                        🍏 iPhone (iOS)
                      </button>
                      <button
                        type="button"
                        className={`guide-tab ${guideTab === 'android' ? 'active' : ''}`}
                        onClick={() => setGuideTab('android')}
                      >
                        🤖 Android
                      </button>
                      <button
                        type="button"
                        className={`guide-tab ${guideTab === 'json' ? 'active' : ''}`}
                        onClick={() => setGuideTab('json')}
                      >
                        📋 Format JSON
                      </button>
                    </div>

                    {guideTab === 'ios' && (
                      <ol className="guide-steps">
                        <li>
                          <span className="step-num">1</span>
                          <div>
                            <strong>Installe une app d'inspection réseau gratuite</strong>
                            <small>Télécharge <strong>Proxyman</strong> ou <strong>Stream</strong> sur l'App Store d'Apple.</small>
                          </div>
                        </li>
                        <li>
                          <span className="step-num">2</span>
                          <div>
                            <strong>Active l'écoute locale</strong>
                            <small>Lance l'application et démarre la capture (le VPN local d'interception s'active en 1 clic).</small>
                          </div>
                        </li>
                        <li>
                          <span className="step-num">3</span>
                          <div>
                            <strong>Ouvre l'application Basic-Fit</strong>
                            <small>Lance l'app officielle Basic-Fit connectée à ton compte. Elle effectue sa requête au démarrage.</small>
                          </div>
                        </li>
                        <li>
                          <span className="step-num">4</span>
                          <div>
                            <strong>Copie la valeur <code>deviceId</code></strong>
                            <small>Retourne dans Proxyman/Stream, filtre les requêtes sur <code>member</code>, et copie la valeur de <code>deviceId</code>.</small>
                          </div>
                        </li>
                      </ol>
                    )}

                    {guideTab === 'android' && (
                      <ol className="guide-steps">
                        <li>
                          <span className="step-num">1</span>
                          <div>
                            <strong>Installe un outil de capture</strong>
                            <small>Télécharge <strong>PCAPdroid</strong> ou <strong>Reqable</strong> depuis le Google Play Store (sans root nécessaire).</small>
                          </div>
                        </li>
                        <li>
                          <span className="step-num">2</span>
                          <div>
                            <strong>Démarre l'enregistrement</strong>
                            <small>Lance la capture du trafic réseau de ton appareil.</small>
                          </div>
                        </li>
                        <li>
                          <span className="step-num">3</span>
                          <div>
                            <strong>Ouvre l'application Basic-Fit</strong>
                            <small>Accède à ton profil membre pour déclencher l'échange avec les serveurs.</small>
                          </div>
                        </li>
                        <li>
                          <span className="step-num">4</span>
                          <div>
                            <strong>Récupère l'identifiant</strong>
                            <small>Inspecte le contenu JSON de la réponse utilisateur et copie le texte du champ <code>"deviceId"</code>.</small>
                          </div>
                        </li>
                      </ol>
                    )}

                    {guideTab === 'json' && (
                      <div className="guide-code-box">
                        <div className="guide-code-header">
                          <span>Structure de la réponse API Basic-Fit :</span>
                          <button
                            type="button"
                            className="guide-copy-btn"
                            onClick={() => {
                              navigator.clipboard.writeText('8d20fc96-1b0e-4982-8292-e97caed114ec')
                              setCopiedExample(true)
                              setTimeout(() => setCopiedExample(false), 2000)
                            }}
                          >
                            {copiedExample ? <Check size={12} /> : <Copy size={12} />}
                            <span>{copiedExample ? 'Copié !' : 'Copier exemple'}</span>
                          </button>
                        </div>
                        <pre className="guide-pre">{`{
  "member": {
    "cardnumber": "${member.memberNumber.trim() || 'V010476970'}",
    "deviceId": "8d20fc96-1b0e-4982-8292-e97caed114ec"
  }
}`}</pre>
                      </div>
                    )}

                    <div className="guide-footer-note">
                      <Sparkles size={14} />
                      <span><strong>Permanent :</strong> ton Device ID ne change jamais tant que tu gardes le même téléphone. Une fois enregistré ici, c'est pour toujours !</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="form-separator" />
              <div className="qr-form-heading"><div><span className="section-kicker">TOUJOURS À JOUR</span><h3>Un pass qui suit ton rythme</h3></div><QrCode size={21} /></div>
              <p className="field-note" style={{ marginTop: '-8px', marginBottom: '16px' }}>
                <Sparkles size={14} /> Ton QR code se renouvelle automatiquement toutes les 5 secondes.
              </p>

              <button className="save-button" type="submit" disabled={busy}>{busy ? <span className="spinner" /> : <><span>Enregistrer mon espace</span><ArrowRight size={18} /></>}</button>
            </form>

            <div className="profile-footnote"><BadgeCheck size={16} /><span>{lastSaved ? `Dernière sauvegarde le ${lastSaved}` : 'Ton profil est visible uniquement quand tu es connecté.'}</span></div>
          </div>
        </section>

        <footer className="dashboard-footer"><span>basicpass <i>·</i> TON ACCÈS, EN TOUTE SIMPLICITÉ</span><button onClick={signOut}>Se déconnecter <LogOut size={14} /></button></footer>
        <nav className="mobile-dock" aria-label="Accès rapide">
          <a href="#pass"><QrCode size={18} /><span>Mon pass</span></a>
          <a href="#profile"><UserRound size={18} /><span>Mon profil</span></a>
        </nav>
      </div>
    </main>
  )
}

function Brand() {
  return <div className="auth-brand"><span className="brand-mark"><Dumbbell size={21} strokeWidth={2.7} /></span><span className="brand-copy"><strong>basic<span>pass</span></strong><small>ESPACE PERSONNEL</small></span></div>
}

function StoryPass() {
  return (
    <div className="story-pass" aria-hidden="true">
      <div className="story-pass-top">
        <div><span>BASIC-FIT</span><strong>MEMBER PASS</strong></div>
        <span className="story-pass-icon"><Dumbbell size={20} /></span>
      </div>
      <div className="story-pass-qr">
        <svg viewBox="0 0 116 116" fill="none">
          <rect width="116" height="116" rx="12" fill="white" />
          <g fill="#17191D">
            <path fillRule="evenodd" d="M8 8h28v28H8V8Zm4 4v20h20V12H12Zm4 4h12v12H16V16ZM80 8h28v28H80V8Zm4 4v20h20V12H84Zm4 4h12v12H88V16ZM8 80h28v28H8V80Zm4 4v20h20V84H12Zm4 4h12v12H16V88Z" />
            <path d="M44 8h8v4h-8zM60 8h4v8h-4zM68 8h4v4h-4zM40 16h8v4h-8zM52 16h4v12h-4zM64 20h12v4H64zM40 24h8v8h-8zM60 28h4v8h-4zM68 28h8v4h-8zM8 44h12v4H8zM24 40h8v8h-8zM36 40h4v12h-4zM44 40h12v4H44zM64 40h8v8h-8zM80 40h4v8h-4zM88 44h12v4H88zM104 40h4v12h-4zM12 52h4v8h-4zM20 52h12v4H20zM40 56h12v4H40zM56 48h4v16h-4zM64 56h12v4H64zM84 52h8v8h-8zM100 56h8v4h-8zM8 64h8v8H8zM24 60h4v12h-4zM32 64h8v4h-8zM44 64h4v8h-4zM52 68h12v4H52zM68 64h4v12h-4zM76 64h8v4h-8zM88 68h12v4H88zM104 64h4v12h-4zM40 80h8v4h-8zM52 76h4v12h-4zM60 80h12v4H60zM76 76h20v4H76zM76 80h4v16h-4zM92 80h4v16h-4zM80 92h12v4H80zM84 84h4v4h-4zM104 84h4v8h-4zM40 92h8v8h-8zM56 92h12v4H56zM64 96h4v12h-4zM44 104h12v4H44zM72 100h12v4H72zM88 104h8v4h-8zM100 100h8v8h-8z" />
          </g>
        </svg>
      </div>
      <div className="story-pass-bottom">
        <div className="story-pass-identity"><span>TON ESPACE MEMBRE</span><strong>À portée de main.</strong></div>
        <span className="story-pass-status"><span className="online-dot" /> EN DIRECT</span>
      </div>
    </div>
  )
}

function AuthScreen(props: {
  mode: AuthMode; setMode: (mode: AuthMode) => void; email: string; setEmail: (value: string) => void
  password: string; setPassword: (value: string) => void; showPassword: boolean; togglePassword: () => void
  busy: boolean; flash: Flash; onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const signup = props.mode === 'signup'
  return (
    <main className="gate-page">
      <div className="gate-layout">
        <section className="gate-story">
          <Brand />
          <div className="story-copy">
            <span className="eyebrow"><span className="eyebrow-line" /> TON PASS. TON RYTHME.</span>
            <h1>La salle t'attend.<br /><span>Ton QR aussi.</span></h1>
            <p>Un espace membre épuré pour garder tes informations Basic-Fit sous la main.</p>
            <div className="story-stamp">
              <span><ShieldCheck size={17} /></span>
              <div><strong>Connexion sécurisée</strong><small>Tes données sont protégées par ton compte.</small></div>
            </div>
          </div>
          <StoryPass />
          <div className="story-fade-mark" aria-hidden="true">B.</div>
          <div className="story-bottom">UN ESPACE PERSONNEL <i>·</i> UNE INTERFACE SANS FIORITURES</div>
        </section>

        <section className="gate-panel">
          <div className="gate-card">
            <div className="mobile-brand"><Brand /></div>
            <div className="panel-eyebrow">{signup ? 'TON ESPACE PERSONNEL' : 'BON RETOUR'}</div>
            <h2>{signup ? 'Créer mon espace' : 'Se connecter'}</h2>
            <p className="gate-subtitle">{signup ? 'Quelques instants pour créer ton espace membre.' : 'Retrouve ton QR et tes informations de membre.'}</p>
            {props.flash && <div className={`flash flash-${props.flash.kind}`} role="status">{props.flash.message}</div>}

            <form className="gate-form" onSubmit={props.onSubmit}>
              <label className="field">
                <span>Adresse e-mail</span>
                <div className="input-wrap">
                  <UserRound size={17} />
                  <input type="email" value={props.email} onChange={(event) => props.setEmail(event.target.value)} placeholder="toi@exemple.fr" autoComplete="email" required />
                </div>
              </label>
              <label className="field">
                <span>Mot de passe du compte</span>
                <div className="input-wrap">
                  <LockKeyhole size={17} />
                  <input type={props.showPassword ? 'text' : 'password'} value={props.password} onChange={(event) => props.setPassword(event.target.value)} placeholder="Au moins 8 caractères" minLength={8} autoComplete={signup ? 'new-password' : 'current-password'} required />
                  <button type="button" className="password-toggle" onClick={props.togglePassword} aria-label={props.showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>{props.showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                </div>
              </label>
              <button className="save-button gate-submit" disabled={props.busy}>
                {props.busy ? <span className="spinner" /> : <><span>{signup ? 'Créer mon compte' : 'Accéder à mon espace'}</span><ArrowRight size={18} /></>}
              </button>
            </form>

            <div className="gate-switch">
              {signup ? 'Tu as déjà un compte ?' : 'Pas encore de compte ?'} <button onClick={() => props.setMode(signup ? 'login' : 'signup')}>{signup ? 'Se connecter' : 'Créer un compte'}</button>
            </div>
            <div className="gate-assurance"><ShieldCheck size={16} /><span>Ton mot de passe Basic-Fit n'est jamais demandé ni enregistré ici.</span></div>
          </div>
          <div className="gate-panel-bottom">© BASIC PASS <span>·</span> ESPACE PRIVÉ</div>
        </section>
      </div>
    </main>
  )
}

function ConfigurationScreen() {
  return <main className="vault-gate-page"><div className="vault-gate-card config-card"><Brand /><span className="vault-big-icon"><ShieldCheck size={25} /></span><span className="panel-eyebrow">CONFIGURATION</span><h1>Relier ton espace</h1><p>Ajoute les identifiants publics de ton projet Supabase, puis applique la migration SQL fournie dans le dépôt.</p><ol className="config-steps"><li><span>1</span><div><strong>Créer un projet Supabase</strong><small>Récupère l'URL du projet et sa clé publishable.</small></div></li><li><span>2</span><div><strong>Configurer l'application</strong><small>Copie <code>.env.example</code> vers <code>.env.local</code> et renseigne les deux valeurs.</small></div></li><li><span>3</span><div><strong>Créer la base de données</strong><small>Exécute la migration SQL du dossier <code>supabase/migrations</code>.</small></div></li></ol><div className="config-warning"><ShieldCheck size={16} /><span>N'ajoute jamais une clé <code>secret</code> ou <code>service_role</code> dans l'application.</span></div></div></main>
}

function LoadingScreen() {
  return <main className="loading-page"><Brand /><span className="spinner spinner-dark" /><p>Ouverture de ton espace privé…</p></main>
}

export default App
