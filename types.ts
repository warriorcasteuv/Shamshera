export type SportId = 'cricket' | 'football' | 'tennis' | 'basketball'
export type Side = 'back' | 'lay'
export type BetStatus = 'open' | 'won' | 'lost'
export type Runner = {
  id: string
  name: string
  back: number
  lay: number
}
export type Market = {
  id: string
  name: string
  runners: Runner[]
  settledRunnerId?: string
}
export type SportEvent = {
  id: string
  sport: SportId
  competition: string
  name: string
  startLabel: string
  inPlay: boolean
  markets: Market[]
}
export type SlipItem = {
  key: string
  eventId: string
  eventName: string
  marketId: string
  marketName: string
  runnerId: string
  runnerName: string
  side: Side
  odds: number
  stake: string
}
export type Bet = {
  id: string
  customerName?: string
  placedAt: string
  eventId: string
  eventName: string
  marketId: string
  marketName: string
  runnerId: string
  runnerName: string
  side: Side
  odds: number
  stake: number
  liability: number
  status: BetStatus
  pnl: number
}
export type LedgerEntry = {
  id: string
  at: string
  label: string
  amount: number
  accountName?: string
}
export type RequestStatus = 'pending' | 'approved' | 'rejected'
export type DepositRequest = {
  id: string
  user: string
  amount: number
  qrId: string
  proof: string
  submittedAt: string
  status: RequestStatus
}
export type WithdrawalRequest = {
  id: string
  user: string
  amount: number
  accountHolder: string
  bankName: string
  accountNumber: string
  ifsc: string
  payoutAmount?: number
  submittedAt: string
  status: RequestStatus
}
export type PaymentQr = { id: string; name: string; image: string }
export type CustomerAccount = {
  id: string
  name: string
  createdAt: string
  assignedEmployeeId: string | null
}
export type StaffRole = 'manager' | 'ceo' | 'employee'
export type AccountRole = 'main_admin' | StaffRole | 'customer'
export type AccountProfile = {
  playerId: string
  user: string
  balance: number
  role: AccountRole
  isUnlimited: boolean
  employeeId: string | null
  staffStatus: 'active' | 'disabled' | null
  permissions: Record<string, boolean>
  bets?: Bet[]
  ledger?: LedgerEntry[]
  settled?: Record<string, string>
}
export type StaffPermissions = {
  reviewDeposits: boolean
  reviewWithdrawals: boolean
  manageQrs: boolean
}
export type StaffMember = {
  id: string
  employeeId: string
  name: string
  role: StaffRole
  balance?: number
  permissions: StaffPermissions
  status: 'invited' | 'active' | 'disabled'
  activationCode: string
}