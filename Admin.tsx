import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatVc } from './money'
import { DEFAULT_STAKE_OPTIONS, useSherabet } from './store'
import type { StaffMember, StaffPermissions, StaffRole } from './types'

type TransferRecipient = { playerId: string; name: string; role: string; balance: number }
type ServerStaff = Omit<StaffMember, 'activationCode'> & { activationCode?: string; balance: number }

async function adminRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  })
  const result = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(result.error ?? 'The server rejected this admin request.')
  return result
}

const emptyPermissions: StaffPermissions = {
  reviewDeposits: false,
  reviewWithdrawals: false,
  manageQrs: false,
}

function readImage(file: File, onLoad: (image: string) => void, onError: (message: string) => void) {
  if (!file.type.startsWith('image/')) return onError('Choose an image file.')
  if (file.size > 800_000) return onError('Image must be smaller than 800 KB.')
  const reader = new FileReader()
  reader.onload = () => typeof reader.result === 'string' && onLoad(reader.result)
  reader.onerror = () => onError('Could not read this image.')
  reader.readAsDataURL(file)
}

export function Admin() {
  const navigate = useNavigate()
  const user = useSherabet((s) => s.user)
  const role = useSherabet((s) => s.role)
  const permissionsForUser = useSherabet((s) => s.permissions)
  const replaceStaff = useSherabet((s) => s.replaceStaff)
  const transferCoins = useSherabet((s) => s.transferCoins)
  const logout = useSherabet((s) => s.logout)
  const staff = useSherabet((s) => s.staff)
  const qrs = useSherabet((s) => s.paymentQrs)
  const deposits = useSherabet((s) => s.depositRequests)
  const withdrawals = useSherabet((s) => s.withdrawalRequests)
  const customers = useSherabet((s) => s.customers)
  const stakeOptions = useSherabet((s) => s.stakeOptions)
  const setStakeOptions = useSherabet((s) => s.setStakeOptions)
  const addPaymentQr = useSherabet((s) => s.addPaymentQr)
  const removePaymentQr = useSherabet((s) => s.removePaymentQr)
  const reviewDeposit = useSherabet((s) => s.reviewDeposit)
  const reviewWithdrawal = useSherabet((s) => s.reviewWithdrawal)
  const assignCustomer = useSherabet((s) => s.assignCustomer)
  const [qrName, setQrName] = useState('')
  const [qrImage, setQrImage] = useState('')
  const [staffName, setStaffName] = useState('')
  const [staffRole, setStaffRole] = useState<StaffRole>('employee')
  const [permissions, setPermissions] = useState<StaffPermissions>(emptyPermissions)
  const [payouts, setPayouts] = useState<Record<string, string>>({})
  const [stakeDraft, setStakeDraft] = useState(stakeOptions.join(', '))
  const [transferRecipient, setTransferRecipient] = useState('')
  const [transferAmount, setTransferAmount] = useState('')
  const [recipients, setRecipients] = useState<TransferRecipient[]>([])
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!role || role === 'customer') {
      navigate('/admin-login', { replace: true })
    }
  }, [role, navigate])

  const isMainAdmin = role === 'main_admin'
  const activeEmployee = Boolean(role && ['ceo', 'manager', 'employee'].includes(role))
  const canManageCustomers = isMainAdmin || role === 'ceo' || role === 'manager'
  const access = (permission: keyof StaffPermissions) => isMainAdmin
    || Boolean(activeEmployee && permissionsForUser[permission])
  const approvedDeposits = deposits.filter((request) => request.status === 'approved')
  const approvedWithdrawals = withdrawals.filter((request) => request.status === 'approved')
  const totalDepositCoins = approvedDeposits.reduce((total, request) => total + request.amount, 0)
  const totalWithdrawalCoins = approvedWithdrawals.reduce((total, request) => total + request.amount, 0)
  const totalPayoutInr = approvedWithdrawals.reduce((total, request) => total + (request.payoutAmount ?? 0), 0)
  useEffect(() => {
    setStakeDraft(stakeOptions.join(', '))
  }, [stakeOptions])

  useEffect(() => {
    if (!role || role === 'customer') return
    let active = true
    const loadData = async () => {
      try {
        const [targetResult, staffResult] = await Promise.all([
          adminRequest<{ recipients: TransferRecipient[] }>('/api/coin-transfers/recipients'),
          isMainAdmin ? adminRequest<{ staff: ServerStaff[] }>('/api/admin/staff') : Promise.resolve(null),
        ])
        if (!active) return
        setRecipients(targetResult.recipients)
        if (staffResult) replaceStaff(staffResult.staff.map((member) => ({ ...member, activationCode: '' })))
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : 'Could not load server account data.')
      }
    }
    void loadData()
    return () => { active = false }
  }, [role, isMainAdmin, replaceStaff])

  function onQrFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) readImage(file, setQrImage, setMessage)
  }

  function onQrSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (qrs.length >= 5) return setMessage('You can add up to 5 payment QR codes.')
    if (!qrName.trim() || !qrImage) return setMessage('Add a QR name and image.')
    addPaymentQr(qrName.trim(), qrImage)
    setQrName('')
    setQrImage('')
    setMessage('Payment QR added.')
  }

  function onStaffSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!staffName.trim()) return setMessage('Enter an employee name.')
    if (staff.some((member) => member.name.toLowerCase() === staffName.trim().toLowerCase())) {
      return setMessage('That employee is already on the team.')
    }
    void adminRequest<{ staffMember: ServerStaff; activationCode: string }>('/api/admin/staff', {
      method: 'POST', body: JSON.stringify({ name: staffName.trim(), role: staffRole, permissions }),
    }).then(({ staffMember, activationCode }) => {
      replaceStaff([...useSherabet.getState().staff, { ...staffMember, activationCode }])
      setStaffName('')
      setPermissions(emptyPermissions)
      setMessage(`${staffMember.name} added. Employee ID: ${staffMember.employeeId}. Sign-in code: ${activationCode}. Share it privately; it is shown only once.`)
      return adminRequest<{ recipients: TransferRecipient[] }>('/api/coin-transfers/recipients')
        .then((result) => setRecipients(result.recipients))
    }).catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : 'Could not create this staff account.')
    })
  }

  function onStakeSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const options = stakeDraft.split(',').map((value) => Number(value.trim()))
    const error = setStakeOptions(options)
    setMessage(error ?? 'Casino stake options saved.')
  }

  async function onTransferSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const error = await transferCoins(transferRecipient, Number(transferAmount))
      if (error) {
        setMessage(error)
        return
      }
      setTransferAmount('')
      setMessage('Coin transfer saved to the server database.')
      const result = await adminRequest<{ recipients: TransferRecipient[] }>('/api/coin-transfers/recipients')
      setRecipients(result.recipients)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not transfer coins.')
    }
  }

  function onLogOut() {
    void fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    logout()
    navigate('/admin-login', { replace: true })
  }

  async function onStaffStatusChange(member: StaffMember) {
    try {
      await adminRequest(`/api/admin/staff/${encodeURIComponent(member.id)}/status`, {
        method: 'PATCH', body: JSON.stringify({ status: member.status === 'active' ? 'disabled' : 'active' }),
      })
      const result = await adminRequest<{ staff: ServerStaff[] }>('/api/admin/staff')
      replaceStaff(result.staff.map((item) => ({ ...item, activationCode: '' })))
      setMessage(`${member.name}'s access updated.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update staff access.')
    }
  }

  async function onStaffPermissionsChange(member: StaffMember, value: StaffPermissions) {
    try {
      await adminRequest(`/api/admin/staff/${encodeURIComponent(member.id)}/permissions`, {
        method: 'PATCH', body: JSON.stringify({ permissions: value }),
      })
      replaceStaff(useSherabet.getState().staff.map((item) => item.id === member.id ? { ...item, permissions: value } : item))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update staff permissions.')
    }
  }

  async function onStaffRemove(member: StaffMember) {
    try {
      await adminRequest(`/api/admin/staff/${encodeURIComponent(member.id)}`, { method: 'DELETE' })
      const result = await adminRequest<{ staff: ServerStaff[] }>('/api/admin/staff')
      replaceStaff(result.staff.map((item) => ({ ...item, activationCode: '' })))
      setMessage(`${member.name}'s access has been disabled.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not disable this staff account.')
    }
  }

  return <section>
    <div className="page-head"><div><h2>Admin desk</h2><p>Manage coin requests, payment QR codes, and team access.</p></div><div className="row-actions"><span className="status-badge pending">Browser-only items</span><button className="ghost" type="button" onClick={onLogOut}>Log out</button></div></div>
    <p className="feature-notice">Staff roles and coin transfers are checked and recorded by the server. QR uploads and payment requests are stored only in this browser; no payment is processed.</p>
    {!isMainAdmin && !activeEmployee && <div className="pad card"><h3>Access not assigned</h3><p className="tiny">Only server-authenticated team accounts can open the staff desk.</p></div>}
    {(isMainAdmin || activeEmployee) && <>
      <div className="admin-meta"><strong>{role?.replace('_', ' ')}</strong><span>Signed in as {user}</span></div>
      {isMainAdmin && <section className="admin-section">
        <header><div><h3>Casino stake settings</h3><p>Set exactly six unique whole-number stake presets for casino games and Ludo.</p></div></header>
        <form className="stake-settings-form" onSubmit={onStakeSave}>
          <label>Stake amounts (coins, comma-separated)
            <input required value={stakeDraft} onChange={(event) => setStakeDraft(event.target.value)} placeholder={DEFAULT_STAKE_OPTIONS.join(', ')} />
          </label>
          <p className="tiny">Current: {stakeOptions.join(' · ')} coins</p>
          <button className="primary" type="submit">Save stake options</button>
        </form>
      </section>}
      {(isMainAdmin || activeEmployee) && <section className="admin-section">
        <header><div><h3>Transfer coins</h3><p>Send existing coins to accounts below your role in the team hierarchy.</p></div></header>
        <form className="coin-transfer-form" onSubmit={onTransferSubmit}>
          <label>Recipient account<select required value={transferRecipient} onChange={(event) => setTransferRecipient(event.target.value)}>
            <option value="">Select an account</option>
            {recipients.map((recipient) => <option key={recipient.playerId} value={recipient.playerId}>
              {recipient.name} · {recipient.role} · {formatVc(recipient.balance)} coins
            </option>)}
          </select></label>
          <label>Amount (coins)<input required type="number" min="0.01" step="0.01" value={transferAmount} onChange={(event) => setTransferAmount(event.target.value)} placeholder="Enter amount" /></label>
          <button className="primary" type="submit">Transfer coins</button>
          <p className="tiny">{isMainAdmin ? 'Main Admin balance is unlimited. CEO starts with 10 crore coins; other staff can transfer only their available balance.' : 'Transfers are deducted from your available coin balance.'}</p>
        </form>
      </section>}
      {canManageCustomers && <section className="admin-section customer-directory"><header><div><h3>Customer directory</h3><p>Signup assignment and approved deposit/withdrawal history.</p></div><span>{customers.length} total signups</span></header>
        <div className="customer-total-grid">
          <div><span>Total signups</span><strong>{customers.length}</strong></div>
          <div><span>Approved deposits</span><strong>{formatVc(totalDepositCoins)} coins</strong></div>
          <div><span>Approved withdrawals</span><strong>{formatVc(totalWithdrawalCoins)} coins</strong></div>
          <div><span>Paid out</span><strong>INR {formatVc(totalPayoutInr)}</strong></div>
        </div>
        {customers.length ? <div className="customer-list">{customers.map((customer) => {
          const customerDeposits = deposits.filter((request) => request.user === customer.name)
          const customerWithdrawals = withdrawals.filter((request) => request.user === customer.name)
          const deposited = customerDeposits.filter((request) => request.status === 'approved').reduce((total, request) => total + request.amount, 0)
          const withdrawn = customerWithdrawals.filter((request) => request.status === 'approved').reduce((total, request) => total + request.amount, 0)
          const payout = customerWithdrawals.filter((request) => request.status === 'approved').reduce((total, request) => total + (request.payoutAmount ?? 0), 0)
          return <article className="customer-record" key={customer.id}>
            <div className="customer-record-head"><div><strong>{customer.name}</strong><span>Signed up {new Date(customer.createdAt).toLocaleString()}</span></div><label>Assigned employee<select value={customer.assignedEmployeeId ?? ''} onChange={(event) => assignCustomer(customer.id, event.target.value || null)}><option value="">Unassigned</option>{staff.filter((member) => member.status === 'active').map((member) => <option key={member.id} value={member.employeeId}>{member.name} · {member.role}</option>)}</select></label></div>
            <div className="customer-financials"><div><span>Deposited</span><strong>{formatVc(deposited)} coins</strong></div><div><span>Withdrawn</span><strong>{formatVc(withdrawn)} coins</strong></div><div><span>Paid out</span><strong>INR {formatVc(payout)}</strong></div></div>
            <details className="customer-history"><summary>Full request history ({customerDeposits.length + customerWithdrawals.length})</summary>
              <div className="customer-history-list">
                {customerDeposits.map((request) => <div className="customer-history-row" key={request.id}><span>Deposit · {formatVc(request.amount)} coins · {new Date(request.submittedAt).toLocaleString()}</span><span className={`status-badge ${request.status}`}>{request.status}</span></div>)}
                {customerWithdrawals.map((request) => <div className="customer-history-row" key={request.id}><span>Withdrawal · {formatVc(request.amount)} coins{request.payoutAmount != null ? ` · INR ${formatVc(request.payoutAmount)}` : ''} · {new Date(request.submittedAt).toLocaleString()}</span><span className={`status-badge ${request.status}`}>{request.status}</span></div>)}
                {!customerDeposits.length && !customerWithdrawals.length && <p className="tiny">No deposit or withdrawal requests.</p>}
              </div>
            </details>
          </article>
        })}</div> : <p className="empty">No customer signups yet.</p>}
      </section>}
      {access('reviewDeposits') && <section className="admin-section"><header><div><h3>Coin deposit requests</h3><p>Verify payment proof before approving a coin balance.</p></div><span>{deposits.filter((item) => item.status === 'pending').length} pending</span></header>
        <div className="admin-request-list">{deposits.length ? deposits.map((request) => <article className="admin-request" key={request.id}>
          <div className="admin-request-top"><div><strong>{request.user}</strong><span>{formatVc(request.amount)} coins · {new Date(request.submittedAt).toLocaleString()}</span></div><span className={`status-badge ${request.status}`}>{request.status}</span></div>
          <img className="review-image" src={request.proof} alt={`Payment proof from ${request.user}`} />
          <div className="row-actions"><button className="primary" type="button" disabled={request.status !== 'pending'} onClick={() => reviewDeposit(request.id, true)}>Approve coins</button><button className="danger-btn" type="button" disabled={request.status !== 'pending'} onClick={() => reviewDeposit(request.id, false)}>Reject</button></div>
        </article>) : <p className="empty">No deposit requests.</p>}</div>
      </section>}

      {access('reviewWithdrawals') && <section className="admin-section"><header><div><h3>Coin withdrawals</h3><p>Verify bank details and arrange the payout before approval.</p></div><span>{withdrawals.filter((item) => item.status === 'pending').length} pending</span></header>
        <div className="admin-request-list">{withdrawals.length ? withdrawals.map((request) => <article className="admin-request" key={request.id}>
          <div className="admin-request-top"><div><strong>{request.user}</strong><span>{formatVc(request.amount)} coins requested · {new Date(request.submittedAt).toLocaleString()}</span></div><span className={`status-badge ${request.status}`}>{request.status}</span></div>
          <dl className="bank-details"><div><dt>Account holder</dt><dd>{request.accountHolder}</dd></div><div><dt>Bank</dt><dd>{request.bankName}</dd></div><div><dt>Account number</dt><dd>{request.accountNumber}</dd></div><div><dt>IFSC</dt><dd>{request.ifsc}</dd></div>{request.payoutAmount != null && <div><dt>Approved payout</dt><dd>INR {formatVc(request.payoutAmount)}</dd></div>}</dl>
          {request.status === 'pending' && <label className="payout-field">Payout amount (INR)<input type="number" min="1" step="0.01" value={payouts[request.id] ?? ''} onChange={(event) => setPayouts((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="Enter approved amount" /></label>}
          <div className="row-actions"><button className="primary" type="button" disabled={request.status !== 'pending' || Number(payouts[request.id]) <= 0} onClick={() => reviewWithdrawal(request.id, true, Number(payouts[request.id]))}>Confirm payout & approve</button><button className="danger-btn" type="button" disabled={request.status !== 'pending'} onClick={() => reviewWithdrawal(request.id, false)}>Reject & return coins</button></div>
        </article>) : <p className="empty">No withdrawal requests.</p>}</div>
      </section>}

      {access('manageQrs') && <section className="admin-section"><header><div><h3>Payment QR codes</h3><p>{qrs.length} of 5 slots used</p></div></header>
        <div className="qr-admin-grid">{qrs.map((qr) => <div className="qr-admin-item" key={qr.id}><img src={qr.image} alt={`${qr.name} QR`} /><strong>{qr.name}</strong><button className="danger-btn" type="button" onClick={() => removePaymentQr(qr.id)}>Remove QR</button></div>)}</div>
        {qrs.length < 5 && <form className="qr-add-form" onSubmit={onQrSubmit}><label>QR label<input required value={qrName} onChange={(event) => setQrName(event.target.value)} placeholder="Example: Payment 1" /></label><label>QR image<input required type="file" accept="image/*" onChange={onQrFile} /></label>{qrImage && <img className="qr-preview" src={qrImage} alt="New QR preview" />}<button className="primary" type="submit">Add payment QR</button></form>}
      </section>}

      {isMainAdmin && <section className="admin-section"><header><div><h3>Team permissions</h3><p>Main admin assigns and can change each employee's access. New team accounts are active and can sign in using the employee ID and one-time displayed code.</p></div></header>
        <form className="staff-form" onSubmit={onStaffSubmit}><label>Employee display name<input required value={staffName} onChange={(event) => setStaffName(event.target.value)} placeholder="Must match their login name" /></label><label>Role<select value={staffRole} onChange={(event) => setStaffRole(event.target.value as StaffRole)}><option value="manager">Manager</option><option value="ceo">CEO</option><option value="employee">Employee</option></select></label>
          <fieldset><legend>Permissions</legend><PermissionChecks value={permissions} onChange={setPermissions} /></fieldset><button className="primary" type="submit">Add team member</button>
        </form>
        <div className="staff-list">{staff.map((member) => <article className="staff-row" key={member.id}>
            <div className="staff-row-head"><div><strong>{member.name}</strong><span>{member.employeeId} · {member.role} · {member.status} · {formatVc(member.balance)} coins</span></div><div className="row-actions"><button className="ghost" type="button" onClick={() => void onStaffStatusChange(member)}>{member.status === 'active' ? 'Disable access' : 'Enable access'}</button><button className="danger-btn" type="button" onClick={() => void onStaffRemove(member)}>Remove</button></div></div>
          {member.status === 'invited' && <p className="activation-code">Share with {member.name}: ID <strong>{member.employeeId}</strong> · code <strong>{member.activationCode}</strong></p>}
          <PermissionChecks value={member.permissions} onChange={(value) => void onStaffPermissionsChange(member, value)} />
        </article>)}</div>
      </section>}
    </>}
    {message && <p className="flash" role="status">{message}</p>}
  </section>
}

function PermissionChecks({ value, onChange }: { value: StaffPermissions; onChange: (permissions: StaffPermissions) => void }) {
  const items: { key: keyof StaffPermissions; label: string }[] = [
    { key: 'reviewDeposits', label: 'Review deposits' },
    { key: 'reviewWithdrawals', label: 'Review withdrawals' },
    { key: 'manageQrs', label: 'Manage payment QR codes' },
  ]
  return <div className="permission-grid">{items.map((item) => <label key={item.key}><input type="checkbox" checked={value[item.key]} onChange={(event) => onChange({ ...value, [item.key]: event.target.checked })} />{item.label}</label>)}</div>
}