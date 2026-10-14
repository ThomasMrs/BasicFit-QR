import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import QRCode from 'qrcode'
import {
  ArrowRight,
  BadgeCheck,
  Check,
  Dumbbell,
  Eye,
  EyeOff,
  FileImage,
  KeyRound,
  LockKeyhole,
  LogOut,
  QrCode,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
} from 'lucide-react'
import type { Session, User } from '@supabase/supabase-js'
import { isSupabaseConfigured, QR_BUCKET, supabase } from './lib/supabase'
import {
  createSalt,
  decodeSalt,
  decryptBytes,
  decryptText,
  deriveVaultKey,
  emptyMemberData,
  encodeSalt,
  encryptBytes,
  encryptText,
  type MemberData,
  type VaultEnvelope,
} from './lib/vault'

type Screen = 'config' | 'loading' | 'auth' | 'create-vault' | 'unlock' | 'dashboard'
type AuthMode = 'login' | 'signup'
type Flash = { kind: 'success' | 'error' | 'info'; message: string } | null

const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
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
  const [envelope, setEnvelope] = useState<VaultEnvelope | null>(null)
  const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null)
  const [member, setMember] = useState<MemberData>(EMPTY_FORM)
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null)
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null)
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [flash, setFlash] = useState<Flash>(null)
  const [busy, setBusy] = useState(false)
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [vaultPassphrase, setVaultPassphrase] = useState('')
  const [confirmPassphrase, setConfirmPassphrase] = useState('')
  const [showPassphrase, setShowPassphrase] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [qrMode, setQrMode] = useState<'text' | 'image'>('text')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const memberInitials = useMemo(() => {
    const parts = member.name.trim().split(/\s+/).filter(Boolean)
    return parts.length ? parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase() : 'BF'
  }, [member.name])

  const inspectSession = useCallback(async (session: Session | null) => {
    if (!session || !supabase) {
      setUser(null)
      setEnvelope(null)
      setVaultKey(null)
      setMember(EMPTY_FORM)
      setQrImageUrl(null)
      setScreen(isSupabaseConfigured ? 'auth' : 'config')
      return
    }

    setUser(session.user)
    setScreen('loading')
    const { data, error } = await supabase
      .from('member_vault')
      .select('user_id, salt, iv, ciphertext, updated_at')
      .eq('user_id', session.user.id)
      .maybeSingle()

    if (error) {
      setFlash({ kind: 'error', message: `Impossible de lire le coffre : ${friendlyError(error.message)}` })
      setScreen('auth')
      return
    }

    if (!data) {
      setEnvelope(null)
      setScreen('create-vault')
      return
    }

    setEnvelope(data as VaultEnvelope)
    setScreen('unlock')
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

  useEffect(() => {
    if (member.qrSource !== 'text' || !member.qrPayload.trim()) {
      setQrCodeUrl(null)
      return
    }
    let cancelled = false
    void QRCode.toDataURL(member.qrPayload.trim(), {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 360,
      color: { dark: '#171717', light: '#ffffff' },
    }).then((dataUrl) => {
      if (!cancelled) setQrCodeUrl(dataUrl)
    }).catch(() => {
      if (!cancelled) setQrCodeUrl(null)
    })
    return () => { cancelled = true }
  }, [member.qrPayload, member.qrSource])

  useEffect(() => {
    if (screen !== 'dashboard') return
    let timer = window.setTimeout(lockVault, 5 * 60 * 1000)
    const refreshTimer = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(lockVault, 5 * 60 * 1000)
    }
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart']
    events.forEach((event) => window.addEventListener(event, refreshTimer, { passive: true }))
    return () => {
      window.clearTimeout(timer)
      events.forEach((event) => window.removeEventListener(event, refreshTimer))
    }
  }, [screen, lockVault])

  useEffect(() => {
    if (!qrImageUrl?.startsWith('blob:')) return
    return () => URL.revokeObjectURL(qrImageUrl)
  }, [qrImageUrl])

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
          setFlash({ kind: 'info', message: 'Compte créé. Confirme ton e-mail, puis connecte-toi pour créer ton coffre.' })
        } else {
          setFlash({ kind: 'success', message: 'Compte créé. Prépare maintenant ta phrase secrète de coffre.' })
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

  async function createVault(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !user) return
    if (vaultPassphrase.length < 12) {
      setFlash({ kind: 'error', message: 'Choisis une phrase secrète de 12 caractères minimum.' })
      return
    }
    if (vaultPassphrase !== confirmPassphrase) {
      setFlash({ kind: 'error', message: 'Les deux phrases secrètes ne correspondent pas.' })
      return
    }
    setBusy(true)
    setFlash(null)
    try {
      const saltBytes = createSalt()
      const key = await deriveVaultKey(vaultPassphrase, saltBytes)
      const encrypted = await encryptText(JSON.stringify(EMPTY_FORM), key)
      const row: VaultEnvelope = {
        user_id: user.id,
        salt: encodeSalt(saltBytes),
        ...encrypted,
      }
      const { data, error } = await supabase.from('member_vault').insert(row).select().single()
      if (error) throw error
      setEnvelope(data as VaultEnvelope)
      setVaultKey(key)
      setMember(EMPTY_FORM)
      setVaultPassphrase('')
      setConfirmPassphrase('')
      setScreen('dashboard')
      setFlash({ kind: 'success', message: 'Coffre créé et chiffré sur cet appareil.' })
    } catch (error) {
      setFlash({ kind: 'error', message: `Création impossible : ${friendlyError(error instanceof Error ? error.message : 'Vérifie la migration Supabase.')}` })
    } finally {
      setBusy(false)
    }
  }

  async function unlockVault(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!envelope) return
    setBusy(true)
    setFlash(null)
    try {
      const key = await deriveVaultKey(vaultPassphrase, decodeSalt(envelope.salt))
      const plaintext = await decryptText(envelope, key)
      const parsed = JSON.parse(plaintext) as MemberData
      const data = { ...EMPTY_FORM, ...parsed }
      let imageUrl: string | null = null
      if (data.qrSource === 'image' && data.imagePath && supabase) {
        const { data: file, error } = await supabase.storage.from(QR_BUCKET).download(data.imagePath)
        if (!error && file) {
          const bytes = await decryptBytes(file, key)
          imageUrl = URL.createObjectURL(new Blob([bytes], { type: data.imageType || 'image/png' }))
        }
      }
      setVaultKey(key)
      setMember(data)
      setQrImageUrl(imageUrl)
      setQrMode(data.qrSource === 'image' ? 'image' : 'text')
      setVaultPassphrase('')
      setScreen('dashboard')
      setFlash(null)
    } catch {
      setFlash({ kind: 'error', message: 'Phrase secrète incorrecte ou coffre illisible.' })
    } finally {
      setBusy(false)
    }
  }

  const lockVault = useCallback(() => {
    setVaultKey(null)
    setMember(EMPTY_FORM)
    setSelectedImage(null)
    setQrImageUrl(null)
    setQrCodeUrl(null)
    setVaultPassphrase('')
    setScreen(user ? 'unlock' : 'auth')
  }, [user])

  async function saveMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !user || !vaultKey || !envelope) return
    if (member.name.trim().length > 80 || member.memberNumber.trim().length > 40 || member.club.trim().length > 100) {
      setFlash({ kind: 'error', message: 'Un champ dépasse la longueur autorisée.' })
      return
    }
    if (member.qrPayload.length > 2048) {
      setFlash({ kind: 'error', message: 'Le contenu du QR est trop long (2 048 caractères maximum).' })
      return
    }
    if (selectedImage && (!ALLOWED_IMAGE_TYPES.has(selectedImage.type) || selectedImage.size > MAX_IMAGE_BYTES)) {
      setFlash({ kind: 'error', message: 'Choisis une image de 2 Mo maximum.' })
      return
    }
    if (qrMode === 'image' && !selectedImage && (!member.imagePath || !qrImageUrl)) {
      setFlash({ kind: 'error', message: 'Ajoute une capture du QR officiel avant d’enregistrer.' })
      return
    }
    if (qrMode === 'text' && !member.qrPayload.trim()) {
      setFlash({ kind: 'error', message: 'Colle le contenu du QR officiel, ou choisis le mode image.' })
      return
    }

    setBusy(true)
    setFlash(null)
    const previousImagePath = member.imagePath
    let nextImagePath = member.imagePath
    let nextImageType = member.imageType
    let uploadedImagePath: string | null = null
    try {
      if (qrMode === 'image' && selectedImage) {
        nextImagePath = `${user.id}/${crypto.randomUUID()}.enc`
        uploadedImagePath = nextImagePath
        nextImageType = selectedImage.type
        const encryptedFile = await encryptBytes(await selectedImage.arrayBuffer(), vaultKey)
        const { error: uploadError } = await supabase.storage.from(QR_BUCKET).upload(nextImagePath, encryptedFile, {
          contentType: 'application/octet-stream',
          upsert: false,
        })
        if (uploadError) throw uploadError
      }

      const nextData: MemberData = {
        name: member.name.trim(),
        memberNumber: member.memberNumber.trim(),
        club: member.club.trim(),
        qrSource: qrMode,
        qrPayload: qrMode === 'text' ? member.qrPayload.trim() : '',
        imagePath: qrMode === 'image' ? nextImagePath : null,
        imageType: qrMode === 'image' ? nextImageType : null,
      }
      const encrypted = await encryptText(JSON.stringify(nextData), vaultKey)
      const { data, error } = await supabase.from('member_vault').upsert({
        user_id: user.id,
        salt: envelope.salt,
        ...encrypted,
      }, { onConflict: 'user_id' }).select().single()
      if (error) throw error

      if (previousImagePath && previousImagePath !== nextData.imagePath) {
        await supabase.storage.from(QR_BUCKET).remove([previousImagePath])
      }
      if (selectedImage && qrMode === 'image') {
        setQrImageUrl(URL.createObjectURL(selectedImage))
      } else if (qrMode === 'text') {
        setQrImageUrl(null)
      }
      setSelectedImage(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setMember(nextData)
      setEnvelope(data as VaultEnvelope)
      setFlash({ kind: 'success', message: 'Ton espace membre est enregistré et chiffré.' })
    } catch (error) {
      if (uploadedImagePath) await supabase.storage.from(QR_BUCKET).remove([uploadedImagePath])
      setFlash({ kind: 'error', message: `Enregistrement impossible : ${friendlyError(error instanceof Error ? error.message : 'Vérifie Supabase.')}` })
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    if (!supabase) return
    lockVault()
    const { error } = await supabase.auth.signOut()
    if (error) setFlash({ kind: 'error', message: friendlyError(error.message) })
  }

  function chooseImage(file?: File) {
    if (!file) return
    if (!ALLOWED_IMAGE_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES) {
      setFlash({ kind: 'error', message: 'Choisis une image de 2 Mo maximum.' })
      return
    }
    setSelectedImage(file)
    setQrMode('image')
    setMember((current) => ({ ...current, qrSource: 'image' }))
    setQrImageUrl(URL.createObjectURL(file))
    setFlash(null)
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
      showPassword={showPassphrase}
      togglePassword={() => setShowPassphrase((value) => !value)}
      busy={busy}
      flash={flash}
      onSubmit={submitAuth}
    />
  }
  if (screen === 'create-vault' || screen === 'unlock') {
    return <VaultGate
      create={screen === 'create-vault'}
      email={user?.email ?? ''}
      password={vaultPassphrase}
      setPassword={setVaultPassphrase}
      confirmation={confirmPassphrase}
      setConfirmation={setConfirmPassphrase}
      showPassword={showPassphrase}
      togglePassword={() => setShowPassphrase((value) => !value)}
      busy={busy}
      flash={flash}
      onSubmit={screen === 'create-vault' ? createVault : unlockVault}
      onSignOut={signOut}
    />
  }

  const hasSavedQr = member.qrSource === 'text' ? Boolean(qrCodeUrl) : member.qrSource === 'image' ? Boolean(qrImageUrl) : false
  const lastSaved = envelope?.updated_at ? new Date(envelope.updated_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null

  return (
    <main className="dashboard-page">
      <div className="dashboard-shell">
        <header className="topbar">
          <a className="brand" href="#top" aria-label="Basic Pass, accueil">
            <span className="brand-mark"><Dumbbell size={20} strokeWidth={2.7} /></span>
            <span className="brand-copy"><strong>basic<span>pass</span></strong><small>COFFRE PERSONNEL</small></span>
          </a>
          <div className="topbar-actions">
            <span className="account-chip"><span className="online-dot" />{user?.email}</span>
            <button className="icon-button lock-button" onClick={lockVault} title="Verrouiller le coffre" aria-label="Verrouiller le coffre">
              <LockKeyhole size={17} /><span>Verrouiller</span>
            </button>
            <button className="icon-button logout-button" onClick={signOut} title="Se déconnecter" aria-label="Se déconnecter"><LogOut size={17} /></button>
          </div>
        </header>

        <section className="welcome-row" id="top">
          <div>
            <div className="eyebrow"><span className="eyebrow-line" /> TON ESPACE MEMBRE</div>
            <h1>Prêt à <span>bouger.</span></h1>
            <p>Ton accès Basic-Fit réuni dans un espace privé, simple et rapide.</p>
          </div>
          <div className="encrypted-pill"><ShieldCheck size={17} /><span>Chiffré sur ton appareil</span></div>
        </section>

        {flash && <div className={`flash flash-${flash.kind}`} role="status"><span className="flash-icon">{flash.kind === 'success' ? <Check size={16} /> : flash.kind === 'error' ? '!' : <ShieldCheck size={16} />}</span>{flash.message}</div>}

        <section className="member-layout">
          <div className="member-column">
            <div className="section-heading"><div><span className="section-kicker">TON PROFIL</span><h2>Carte de membre</h2></div><span className="member-avatar">{memberInitials}</span></div>

            <form className="profile-form" onSubmit={saveMember}>
              <div className="form-grid">
                <label className="field"><span>Nom affiché</span><div className="input-wrap"><UserRound size={17} /><input value={member.name} onChange={(event) => setMember({ ...member, name: event.target.value })} placeholder="Ex. Alex Martin" maxLength={80} autoComplete="name" /></div></label>
                <label className="field"><span>Numéro d’adhérent <button type="button" className="inline-eye" onClick={() => setShowDetails(!showDetails)} aria-label={showDetails ? 'Masquer le numéro' : 'Afficher le numéro'}>{showDetails ? <EyeOff size={14} /> : <Eye size={14} />}</button></span><div className="input-wrap"><KeyRound size={17} /><input value={member.memberNumber} onChange={(event) => setMember({ ...member, memberNumber: event.target.value })} placeholder="Ton numéro de membre" maxLength={40} autoComplete="off" type={showDetails ? 'text' : 'password'} /></div></label>
                <label className="field field-full"><span>Salle habituelle <em>FACULTATIF</em></span><div className="input-wrap"><Dumbbell size={17} /><input value={member.club} onChange={(event) => setMember({ ...member, club: event.target.value })} placeholder="Ex. Paris République" maxLength={100} /></div></label>
              </div>

              <div className="form-separator" />
              <div className="qr-form-heading"><div><span className="section-kicker">TON QR CODE</span><h3>Comment veux-tu l’ajouter ?</h3></div><QrCode size={21} /></div>
              <div className="source-switch" role="tablist" aria-label="Source du QR code">
                <button type="button" role="tab" aria-selected={qrMode === 'text'} className={qrMode === 'text' ? 'source-tab active' : 'source-tab'} onClick={() => { setQrMode('text'); setMember({ ...member, qrSource: 'text' }) }}><QrCode size={16} />Coller le contenu</button>
                <button type="button" role="tab" aria-selected={qrMode === 'image'} className={qrMode === 'image' ? 'source-tab active' : 'source-tab'} onClick={() => { setQrMode('image'); setMember({ ...member, qrSource: 'image' }) }}><FileImage size={16} />Importer une image</button>
              </div>

              {qrMode === 'text' ? (
                <label className="field qr-input-field"><span>Contenu du QR fourni par l’application Basic-Fit</span><textarea value={member.qrPayload} onChange={(event) => setMember({ ...member, qrPayload: event.target.value, qrSource: 'text' })} placeholder="Colle ici le texte contenu dans ton QR officiel…" rows={3} maxLength={2048} spellCheck={false} autoComplete="off" /></label>
              ) : (
                <div className="upload-zone" onClick={() => fileInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); chooseImage(event.dataTransfer.files[0]) }} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click() }}>
                  <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => chooseImage(event.target.files?.[0])} />
                  <span className="upload-icon"><Upload size={20} /></span>
                  <span className="upload-copy"><strong>{selectedImage?.name ?? (member.imagePath ? 'Image enregistrée dans le coffre' : 'Dépose ton QR officiel ici')}</strong><small>PNG, JPG ou WebP · 2 Mo maximum</small></span>
                  <span className="upload-action">Parcourir</span>
                </div>
              )}
              <p className="field-note"><ShieldCheck size={14} /> Le QR et tes informations sont chiffrés avant leur envoi.</p>
              <button className="save-button" type="submit" disabled={busy}>{busy ? <span className="spinner" /> : <><span>Enregistrer mon espace</span><ArrowRight size={18} /></>}</button>
            </form>

            <div className="profile-footnote"><BadgeCheck size={16} /><span>{lastSaved ? `Dernière sauvegarde le ${lastSaved}` : 'Ton profil est privé et visible uniquement après déverrouillage.'}</span></div>
          </div>

          <aside className="pass-column">
            <div className="pass-card">
              <div className="pass-card-top"><div><span className="pass-overline">BASIC-FIT</span><strong>MEMBER PASS</strong></div><span className="pass-brand-icon"><Dumbbell size={17} /></span></div>
              <div className="pass-divider"><span /></div>
              <div className="qr-stage">
                {hasSavedQr ? (
                  member.qrSource === 'text' ? <img className="qr-image" src={qrCodeUrl ?? undefined} alt="QR code enregistré" /> : <img className="qr-image qr-imported-image" src={qrImageUrl ?? undefined} alt="Image du QR code officiel" />
                ) : (
                  <div className="qr-placeholder"><span className="qr-placeholder-icon"><QrCode size={36} /></span><strong>Ton QR apparaîtra ici</strong><span>Ajoute-le depuis le formulaire</span></div>
                )}
              </div>
              <div className="pass-person"><span className="pass-initials">{memberInitials}</span><div className="pass-person-copy"><span>MEMBRE</span><strong>{member.name || 'Ton nom'}</strong><small>{showDetails && member.memberNumber ? member.memberNumber : member.memberNumber ? `•••• ${member.memberNumber.slice(-4)}` : 'Numéro non renseigné'}</small></div><span className="pass-check"><Check size={15} /></span></div>
              <div className="pass-bottom"><span><span className="online-dot" /> ESPACE PERSONNEL</span><span>NO. {member.memberNumber ? member.memberNumber.slice(-4) : '——'}</span></div>
            </div>

            <div className="security-note"><span className="security-icon"><LockKeyhole size={17} /></span><div><strong>Ton coffre, ta clé.</strong><p>Les données restent illisibles sur Supabase. Seule ta phrase secrète de coffre peut les déchiffrer.</p></div></div>
            <div className="expiry-note"><Sparkles size={15} /><span>Un QR Basic-Fit peut expirer. Pour l’entrée, utilise le QR à jour fourni par l’application officielle.</span></div>
          </aside>
        </section>

        <footer className="dashboard-footer"><span>basicpass <i>·</i> TON ACCÈS, EN TOUTE SIMPLICITÉ</span><button onClick={signOut}>Se déconnecter <LogOut size={14} /></button></footer>
      </div>
    </main>
  )
}

function Brand() {
  return <div className="auth-brand"><span className="brand-mark"><Dumbbell size={21} strokeWidth={2.7} /></span><span className="brand-copy"><strong>basic<span>pass</span></strong><small>COFFRE PERSONNEL</small></span></div>
}

function AuthScreen(props: {
  mode: AuthMode; setMode: (mode: AuthMode) => void; email: string; setEmail: (value: string) => void
  password: string; setPassword: (value: string) => void; showPassword: boolean; togglePassword: () => void
  busy: boolean; flash: Flash; onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const signup = props.mode === 'signup'
  return <main className="gate-page"><div className="gate-layout"><section className="gate-story"><Brand /><div className="story-copy"><span className="eyebrow"><span className="eyebrow-line" /> TON PASS. TON RYTHME.</span><h1>La salle t’attend.<br /><span>Ton QR aussi.</span></h1><p>Un espace membre épuré pour garder tes informations Basic-Fit sous la main, et sous clé.</p><div className="story-stamp"><span><ShieldCheck size={17} /></span><div><strong>Chiffrement avant envoi</strong><small>Ta phrase secrète ne quitte jamais ton appareil.</small></div></div></div><div className="story-fade-mark">B.</div><div className="story-bottom">UN COFFRE PERSONNEL <i>·</i> UNE INTERFACE SANS FIORITURES</div></section>
    <section className="gate-panel"><div className="gate-card"><div className="mobile-brand"><Brand /></div><div className="panel-eyebrow">{signup ? 'TON ESPACE PERSONNEL' : 'BON RETOUR'}</div><h2>{signup ? 'Créer mon espace' : 'Se connecter'}</h2><p className="gate-subtitle">{signup ? 'Quelques instants pour mettre ton accès à l’abri.' : 'Retrouve ton QR et tes informations de membre.'}</p>
      {props.flash && <div className={`flash flash-${props.flash.kind}`} role="status">{props.flash.message}</div>}
      <form className="gate-form" onSubmit={props.onSubmit}>
        <label className="field"><span>Adresse e-mail</span><div className="input-wrap"><UserRound size={17} /><input type="email" value={props.email} onChange={(event) => props.setEmail(event.target.value)} placeholder="toi@exemple.fr" autoComplete="email" required /></div></label>
        <label className="field"><span>Mot de passe du compte</span><div className="input-wrap"><LockKeyhole size={17} /><input type={props.showPassword ? 'text' : 'password'} value={props.password} onChange={(event) => props.setPassword(event.target.value)} placeholder="Au moins 8 caractères" minLength={8} autoComplete={signup ? 'new-password' : 'current-password'} required /><button type="button" className="password-toggle" onClick={props.togglePassword} aria-label={props.showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>{props.showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
        <button className="save-button gate-submit" disabled={props.busy}>{props.busy ? <span className="spinner" /> : <><span>{signup ? 'Créer mon compte' : 'Accéder à mon coffre'}</span><ArrowRight size={18} /></>}</button>
      </form>
      <div className="gate-switch">{signup ? 'Tu as déjà un compte ?' : 'Pas encore de compte ?'} <button onClick={() => props.setMode(signup ? 'login' : 'signup')}>{signup ? 'Se connecter' : 'Créer un compte'}</button></div>
      <div className="gate-assurance"><ShieldCheck size={16} /><span>Ton mot de passe Basic-Fit n’est jamais demandé ni enregistré ici.</span></div>
    </div><div className="gate-panel-bottom">© BASIC PASS <span>·</span> ESPACE PRIVÉ</div></section></div></main>
}

function VaultGate(props: {
  create: boolean; email: string; password: string; setPassword: (value: string) => void
  confirmation: string; setConfirmation: (value: string) => void; showPassword: boolean; togglePassword: () => void
  busy: boolean; flash: Flash; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onSignOut: () => void
}) {
  return <main className="vault-gate-page"><div className="vault-gate-card"><Brand /><span className="vault-big-icon"><KeyRound size={25} /></span><span className="panel-eyebrow">{props.create ? 'DERNIÈRE ÉTAPE' : 'COFFRE VERROUILLÉ'}</span><h1>{props.create ? 'Créer ta clé secrète' : 'Déverrouiller le coffre'}</h1><p>{props.create ? 'Choisis une phrase secrète différente de ton mot de passe de compte. Elle chiffre tes données directement sur cet appareil.' : <>Connecté en tant que <strong>{props.email}</strong>. Entre ta phrase secrète pour lire tes données.</>}</p>
      {props.flash && <div className={`flash flash-${props.flash.kind}`} role="status">{props.flash.message}</div>}
      <form className="gate-form" onSubmit={props.onSubmit}>
        <label className="field"><span>Phrase secrète du coffre</span><div className="input-wrap"><KeyRound size={17} /><input type={props.showPassword ? 'text' : 'password'} value={props.password} onChange={(event) => props.setPassword(event.target.value)} placeholder="12 caractères minimum" minLength={12} autoComplete={props.create ? 'new-password' : 'off'} required autoFocus /><button type="button" className="password-toggle" onClick={props.togglePassword} aria-label={props.showPassword ? 'Masquer' : 'Afficher'}>{props.showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
        {props.create && <label className="field"><span>Confirmer la phrase secrète</span><div className="input-wrap"><KeyRound size={17} /><input type={props.showPassword ? 'text' : 'password'} value={props.confirmation} onChange={(event) => props.setConfirmation(event.target.value)} placeholder="Répète ta phrase secrète" minLength={12} autoComplete="new-password" required /></div></label>}
        <button className="save-button gate-submit" disabled={props.busy}>{props.busy ? <span className="spinner" /> : <><span>{props.create ? 'Créer mon coffre' : 'Déverrouiller'}</span><ArrowRight size={18} /></>}</button>
      </form>
      {props.create && <div className="no-recovery"><LockKeyhole size={15} /><span>Cette phrase secrète ne peut pas être récupérée. Garde-la en lieu sûr.</span></div>}
      <button className="gate-logout" onClick={props.onSignOut}><LogOut size={15} /> Se déconnecter</button>
    </div></main>
}

function ConfigurationScreen() {
  return <main className="vault-gate-page"><div className="vault-gate-card config-card"><Brand /><span className="vault-big-icon"><ShieldCheck size={25} /></span><span className="panel-eyebrow">CONFIGURATION</span><h1>Relier ton coffre</h1><p>Ajoute les identifiants publics de ton projet Supabase, puis applique la migration SQL fournie dans le dépôt.</p><ol className="config-steps"><li><span>1</span><div><strong>Créer un projet Supabase</strong><small>Récupère l’URL du projet et sa clé publishable.</small></div></li><li><span>2</span><div><strong>Configurer l’application</strong><small>Copie <code>.env.example</code> vers <code>.env.local</code> et renseigne les deux valeurs.</small></div></li><li><span>3</span><div><strong>Créer le coffre privé</strong><small>Exécute la migration SQL du dossier <code>supabase/migrations</code>.</small></div></li></ol><div className="config-warning"><ShieldCheck size={16} /><span>N’ajoute jamais une clé <code>secret</code> ou <code>service_role</code> dans l’application.</span></div></div></main>
}

function LoadingScreen() {
  return <main className="loading-page"><Brand /><span className="spinner spinner-dark" /><p>Ouverture de ton espace privé…</p></main>
}

export default App
