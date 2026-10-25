import { useState, type ChangeEvent, type FormEvent } from 'react'
import { formatVc } from './money'
import { useSherabet } from './store'

function readImage(file: File, onLoad: (image: string) => void, onError: (message: string) => void) {
  if (!file.type.startsWith('image/')) {
    onError('Choose an image file.')
    return
  }
  if (file.size > 800_000) {
    onError('Image must be smaller than 800 KB.')
    return
  }
  const reader = new FileReader()
  reader.onload = () => typeof reader.result === 'string' && onLoad(reader.result)
  reader.onerror = () => onError('Could not read this image.')
  reader.readAsDataURL(file)
}

export function Account() {
  const user = useSherabet((s) => s.user)
  const isUnlimited = useSherabet((s) => s.isUnlimited)
  const balance = useSherabet((s) => s.balance)
  const ledger = useSherabet((s) => s.ledger)
  const paymentQrs = useSherabet((s) => s.paymentQrs)
  const allDeposits = useSherabet((s) => s.depositRequests)
  const allWithdrawals = useSherabet((s) => s.withdrawalRequests)
  const submitDeposit = useSherabet((s) => s.submitDeposit)
  const submitWithdrawal = useSherabet((s) => s.submitWithdrawal)
  const deposits = allDeposits.filter((request) => request.user === user)
  const withdrawals = allWithdrawals.filter((request) => request.user === user)
  const [depositAmount, setDepositAmount] = useState('')
  const [qrId, setQrId] = useState('')
  const [proof, setProof] = useState('')
  const [withdrawalAmount, setWithdrawalAmount] = useState('')
  const [accountHolder, setAccountHolder] = useState('')
  const [bankName, setBankName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [ifsc, setIfsc] = useState('')
  const [message, setMessage] = useState('')
  const selectedQr = paymentQrs.find((qr) => qr.id === qrId)
  const accountLedger = ledger.filter((entry) => entry.accountName?.toLowerCase() === user?.toLowerCase())

  function onProofChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) readImage(file, setProof, setMessage)
  }

  function onDepositSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const amount = Number(depositAmount)
    if (!Number.isFinite(amount) || amount <= 0 || !selectedQr || !proof) {
      setMessage('Choose a QR, enter the coin amount, and upload payment proof.')
      return
    }
    submitDeposit(amount, qrId, proof)
    setDepositAmount('')
    setProof('')
    setMessage('Deposit request submitted for admin review.')
  }

  function onWithdrawalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const error = submitWithdrawal({
      amount: Number(withdrawalAmount), accountHolder: accountHolder.trim(),
      bankName: bankName.trim(), accountNumber: accountNumber.trim(), ifsc: ifsc.trim().toUpperCase(),
    })
    if (error) {
      setMessage(error)
      return
    }
    setWithdrawalAmount('')
    setAccountHolder('')
    setBankName('')
    setAccountNumber('')
    setIfsc('')
    setMessage('Withdrawal request submitted. Coins are held until review.')
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h2>Coins & requests</h2>
          <p>Balance: <strong>{isUnlimited ? 'Unlimited coins' : `${formatVc(balance)} coins`}</strong></p>
        </div>
        <span className="status-badge pending">Demo review</span>
      </div>
      <p className="demo-notice">Demo only. Requests and uploaded images stay in this browser; no payment is processed.</p>
      <div className="account-grid">
        <form className="pad card request-form" onSubmit={onDepositSubmit}>
          <div className="form-heading"><span>01</span><h3>Deposit coins</h3></div>
          <label>Coin amount<input type="number" min="1" step="1" required value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} placeholder="Enter amount" /></label>
          <label>Payment QR<select required value={qrId} onChange={(event) => setQrId(event.target.value)}>
            <option value="">Select QR</option>
            {paymentQrs.map((qr) => <option value={qr.id} key={qr.id}>{qr.name}</option>)}
          </select></label>
          {selectedQr && <img className="qr-preview" src={selectedQr.image} alt={`${selectedQr.name} payment QR`} />}
          <label>Payment screenshot<input type="file" accept="image/*" required onChange={onProofChange} /></label>
          {proof && <img className="proof-preview" src={proof} alt="Payment proof preview" />}
          <button className="primary" type="submit" disabled={!paymentQrs.length}>Submit deposit request</button>
          {!paymentQrs.length && <p className="tiny">No payment QR has been added by admin yet.</p>}
        </form>

        <form className="pad card request-form" onSubmit={onWithdrawalSubmit}>
          <div className="form-heading"><span>02</span><h3>Withdraw coins</h3></div>
          <label>Coin amount<input type="number" min="1" step="1" max={balance} required value={withdrawalAmount} onChange={(event) => setWithdrawalAmount(event.target.value)} placeholder="Enter amount" /></label>
          <label>Account holder<input required value={accountHolder} onChange={(event) => setAccountHolder(event.target.value)} autoComplete="name" /></label>
          <label>Bank name<input required value={bankName} onChange={(event) => setBankName(event.target.value)} /></label>
          <label>Account number<input required inputMode="numeric" value={accountNumber} onChange={(event) => setAccountNumber(event.target.value)} autoComplete="off" /></label>
          <label>IFSC code<input required value={ifsc} onChange={(event) => setIfsc(event.target.value)} autoComplete="off" /></label>
          <p className="tiny">Admin confirms payout details and amount before approving. Coins are returned if rejected.</p>
          <button className="primary" type="submit">Submit withdrawal request</button>
        </form>
      </div>
      {message && <p className="flash" role="status">{message}</p>}

      <div className="account-grid request-lists">
        <RequestList title="Deposit requests" requests={deposits.map((request) => ({ id: request.id, amount: request.amount, status: request.status, submittedAt: request.submittedAt }))} />
        <RequestList title="Withdrawal requests" requests={withdrawals.map((request) => ({ id: request.id, amount: request.amount, status: request.status, submittedAt: request.submittedAt }))} />
      </div>

      <div className="card pad statement">
        <h3>Coin statement</h3>
        {accountLedger.length ? <table className="table"><thead><tr><th>When</th><th>Detail</th><th>Coins</th></tr></thead><tbody>
          {accountLedger.map((row) => <tr key={row.id}><td className="tiny">{new Date(row.at).toLocaleString()}</td><td>{row.label}</td><td className={row.amount > 0 ? 'won' : row.amount < 0 ? 'lost' : ''}>{row.amount > 0 ? '+' : ''}{formatVc(row.amount)}</td></tr>)}
        </tbody></table> : <p className="empty">No coin activity yet.</p>}
      </div>
    </section>
  )
}

function RequestList({ title, requests }: { title: string; requests: { id: string; amount: number; status: string; submittedAt: string }[] }) {
  return <div className="pad card">
    <h3>{title}</h3>
    {requests.length ? requests.map((request) => <div className="request-row" key={request.id}>
      <div><strong>{formatVc(request.amount)} coins</strong><span>{new Date(request.submittedAt).toLocaleString()}</span></div>
      <span className={`status-badge ${request.status}`}>{request.status}</span>
    </div>) : <p className="empty">No requests yet.</p>}
  </div>
}