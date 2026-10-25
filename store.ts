import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { EVENTS } from './catalog'
import { jitterOdds, liability, potentialWin, round2 } from './money'
import type {
  AccountProfile, Bet, CustomerAccount, DepositRequest, LedgerEntry, PaymentQr, Side, SlipItem,
  SportEvent, StaffMember, StaffPermissions, StaffRole, WithdrawalRequest,
} from './types'
type State = {
  user: string | null
  playerId: string | null
  role: AccountProfile['role'] | null
  isUnlimited: boolean
  permissions: Record<string, boolean>
  authReady: boolean
  balance: number
  accountBalances: Record<string, number>
  stakeOptions: number[]
  payLudoEntry: (amount: number) => string | null
  refundLudoEntry: (amount: number) => void
  awardLudoPrize: (amount: number) => void
  events: SportEvent[]
  settled: Record<string, string>
  slip: SlipItem[]
  bets: Bet[]
  ledger: LedgerEntry[]
  depositRequests: DepositRequest[]
  withdrawalRequests: WithdrawalRequest[]
  paymentQrs: PaymentQr[]
  customers: CustomerAccount[]
  staff: StaffMember[]
  mainAdmin: string | null
  setStakeOptions: (options: number[]) => string | null
  transferCoins: (recipientId: string, amount: number) => Promise<string | null>
  setServerProfile: (profile: AccountProfile) => void
  clearSession: () => void
  replaceStaff: (staff: StaffMember[]) => void
  login: (name: string, isStaff?: boolean) => void
  logout: () => void
  tickOdds: () => void
  addToSlip: (item: Omit<SlipItem, 'key' | 'stake'>) => void
  updateStake: (key: string, stake: string) => void
  removeSlip: (key: string) => void
  clearSlip: () => void
  placeBets: () => string | null
  settleMarket: (eventId: string, marketId: string, winnerId: string) => void
  submitDeposit: (amount: number, qrId: string, proof: string) => void
  submitWithdrawal: (request: Omit<WithdrawalRequest, 'id' | 'user' | 'submittedAt' | 'status'>) => string | null
  reviewDeposit: (id: string, approved: boolean) => void
  reviewWithdrawal: (id: string, approved: boolean, payoutAmount?: number) => void
  addPaymentQr: (name: string, image: string) => void
  removePaymentQr: (id: string) => void
  setMainAdmin: (name: string) => void
  addStaffMember: (name: string, role: StaffRole, permissions: StaffPermissions) => { employeeId: string; activationCode: string }
  activateStaff: (employeeId: string, activationCode: string) => string | null
  setStaffStatus: (id: string, status: StaffMember['status']) => void
  updateStaffPermissions: (id: string, permissions: StaffPermissions) => void
  removeStaffMember: (id: string) => void
  assignCustomer: (customerId: string, employeeId: string | null) => void
}
export const DEFAULT_STAKE_OPTIONS = [100, 200, 500, 1000, 5000, 10000]
const CEO_STARTING_BALANCE = 100_000_000
const UNLIMITED_BALANCE = Number.MAX_SAFE_INTEGER
function accountKey(name: string | null) {
  return (name ?? 'Player').trim().toLowerCase()
}
function currentBalancePatch(state: Pick<State, 'user' | 'isUnlimited' | 'accountBalances'>, balance: number) {
  if (state.isUnlimited) return { balance: UNLIMITED_BALANCE }
  const name = accountKey(state.user)
  return { balance, accountBalances: { ...state.accountBalances, [name]: balance } }
}
function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}
function applySettled(events: SportEvent[], settled: Record<string, string>): SportEvent[] {
  return events.map((ev) => ({
    ...ev,
    markets: ev.markets.map((m) =>
      settled[m.id] ? { ...m, settledRunnerId: settled[m.id] } : m,
    ),
  }))
}
export const useSherabet = create<State>()(
  persist(
    (set, get) => ({
      user: null,
      playerId: null,
      role: null,
      isUnlimited: false,
      permissions: {},
      authReady: false,
      balance: 0,
      accountBalances: {},
      stakeOptions: DEFAULT_STAKE_OPTIONS,
      payLudoEntry: (amount) => {
        if (!Number.isFinite(amount) || amount <= 0) return 'Enter a valid coin entry fee.'
        const roundedAmount = round2(amount)
        const { balance, ledger } = get()
        if (roundedAmount > balance) return 'Not enough coins for this Ludo entry fee.'
        set({
          ...currentBalancePatch(get(), round2(balance - roundedAmount)),
          ledger: [{
            id: uid('led'),
            at: new Date().toISOString(),
            label: 'Ludo lobby entry fee',
            amount: -roundedAmount,
            accountName: get().user ?? 'Player',
          }, ...ledger],
        })
        return null
      },
      refundLudoEntry: (amount) => {
        if (!Number.isFinite(amount) || amount <= 0) return
        const roundedAmount = round2(amount)
        set((s) => ({
          ...currentBalancePatch(s, round2(s.balance + roundedAmount)),
          ledger: [{
            id: uid('led'),
            at: new Date().toISOString(),
            label: 'Ludo entry fee refunded',
            amount: roundedAmount,
            accountName: s.user ?? 'Player',
          }, ...s.ledger],
        }))
      },
      awardLudoPrize: (amount) => {
        if (!Number.isFinite(amount) || amount <= 0) return
        const roundedAmount = round2(amount)
        set((s) => ({
          ...currentBalancePatch(s, round2(s.balance + roundedAmount)),
          ledger: [{
            id: uid('led'),
            at: new Date().toISOString(),
            label: 'Ludo winner payout (after 10% fee)',
            amount: roundedAmount,
            accountName: s.user ?? 'Player',
          }, ...s.ledger],
        }))
      },
      events: EVENTS,
      settled: {},
      slip: [],
      bets: [],
      ledger: [],
      depositRequests: [],
      withdrawalRequests: [],
      paymentQrs: [],
      customers: [],
      staff: [],
      mainAdmin: null,
      login: (name, isStaff = false) => set((s) => {
        const normalizedName = name.trim() || 'Player'
        const key = accountKey(normalizedName)
        const isMainAdmin = s.isUnlimited
        const member = s.staff.find((staffMember) => staffMember.name.toLowerCase() === key)
        const legacyBalance = s.user && accountKey(s.user) === key ? s.balance : 0
        const balance = s.accountBalances[key] ?? (member?.role === 'ceo' ? CEO_STARTING_BALANCE : legacyBalance)
        if (isStaff || isMainAdmin) {
          return {
            user: normalizedName,
            balance: isMainAdmin ? UNLIMITED_BALANCE : balance,
            accountBalances: isMainAdmin ? s.accountBalances : { ...s.accountBalances, [key]: balance },
          }
        }
        const exists = s.customers.some((customer) => customer.name.toLowerCase() === normalizedName.toLowerCase())
        return {
          user: normalizedName,
          balance,
          accountBalances: { ...s.accountBalances, [key]: balance },
          customers: exists ? s.customers : [...s.customers, {
            id: uid('customer'), name: normalizedName, createdAt: new Date().toISOString(), assignedEmployeeId: null,
          }],
        }
      }),
      logout: () => set({
        user: null, playerId: null, role: null, isUnlimited: false, permissions: {}, authReady: true, balance: 0, slip: [],
      }),
      tickOdds: () =>
        set((s) => ({
          events: s.events.map((ev) => ({
            ...ev,
            markets: ev.markets.map((m) =>
              s.settled[m.id]
                ? { ...m, settledRunnerId: s.settled[m.id] }
                : {
                    ...m,
                    runners: m.runners.map((r) => {
                      const back = jitterOdds(r.back)
                      const lay = round2(Math.max(back + 0.02, r.lay + (Math.random() - 0.5) * 0.05))
                      return { ...r, back, lay }
                    }),
                  },
            ),
          })),
        })),
      addToSlip: (item) =>
        set((s) => {
          const key = `${item.marketId}-${item.runnerId}-${item.side}`
          const existing = s.slip.find((x) => x.key === key)
          if (existing) {
            return {
              slip: s.slip.map((x) =>
                x.key === key ? { ...x, odds: item.odds } : x,
              ),
            }
          }
          return {
            slip: [
              ...s.slip,
              { ...item, key, stake: '100' },
            ],
          }
        }),
      updateStake: (key, stake) =>
        set((s) => ({
          slip: s.slip.map((x) => (x.key === key ? { ...x, stake } : x)),
        })),
      removeSlip: (key) => set((s) => ({ slip: s.slip.filter((x) => x.key !== key) })),
      clearSlip: () => set({ slip: [] }),
      placeBets: () => {
        const { slip, balance, user, events, bets, ledger } = get()
        if (!slip.length) return 'Add a selection first.'
        const prepared: Bet[] = []
        let locked = 0
        for (const item of slip) {
          const stake = Number(item.stake)
          if (!Number.isFinite(stake) || stake <= 0) return 'Enter a valid stake.'
          const event = events.find((e) => e.id === item.eventId)
          const market = event?.markets.find((m) => m.id === item.marketId)
          if (!event || !market) return 'Market no longer available.'
          if (market.settledRunnerId) return `${market.name} is already settled.`
          const liab = liability(item.side, item.odds, stake)
          locked = round2(locked + liab)
          prepared.push({
            id: uid('bet'),
            customerName: user ?? 'Player',
            placedAt: new Date().toISOString(),
            eventId: item.eventId,
            eventName: item.eventName,
            marketId: item.marketId,
            marketName: item.marketName,
            runnerId: item.runnerId,
            runnerName: item.runnerName,
            side: item.side,
            odds: item.odds,
            stake: round2(stake),
            liability: liab,
            status: 'open',
            pnl: 0,
          })
        }
        if (locked > balance) return `Need ${locked.toFixed(2)} coins locked. Balance is ${balance.toFixed(2)} coins.`
        set({
          ...currentBalancePatch(get(), round2(balance - locked)),
          bets: [...prepared, ...bets],
          slip: [],
          ledger: [
            {
               id: uid('led'),
              at: new Date().toISOString(),
              label: `Placed ${prepared.length} bet${prepared.length > 1 ? 's' : ''}`,
              amount: -locked,
               accountName: user ?? 'Player',
            },
            ...ledger,
          ],
        })
        return null
      },
      submitDeposit: (amount, qrId, proof) =>
        set((s) => ({
          depositRequests: [{
            id: uid('dep'), user: s.user ?? 'Player', amount: round2(amount), qrId,
            proof, submittedAt: new Date().toISOString(), status: 'pending',
          }, ...s.depositRequests],
        })),
      submitWithdrawal: (request) => {
        const { balance, user, ledger } = get()
        if (!Number.isFinite(request.amount) || request.amount <= 0) return 'Enter a valid coin amount.'
        if (request.amount > balance) return 'Not enough coins available.'
        const amount = round2(request.amount)
        set((s) => ({
          ...currentBalancePatch(s, round2(s.balance - amount)),
          withdrawalRequests: [{
            ...request, id: uid('wd'), user: user ?? 'Player', amount,
            submittedAt: new Date().toISOString(), status: 'pending',
          }, ...s.withdrawalRequests],
          ledger: [{
            id: uid('led'), at: new Date().toISOString(), label: 'Withdrawal request pending', amount: -amount,
            accountName: user ?? 'Player',
          }, ...ledger],
        }))
        return null
      },
      reviewDeposit: (id, approved) =>
        set((s) => {
          const request = s.depositRequests.find((item) => item.id === id && item.status === 'pending')
          if (!request) return s
          const ownerKey = accountKey(request.user)
          const ownerBalance = s.accountBalances[ownerKey] ?? 0
          const ownerIsMainAdmin = s.isUnlimited && accountKey(s.user) === ownerKey
          const creditedBalance = round2(ownerBalance + request.amount)
          const accountBalances = approved && !ownerIsMainAdmin
            ? { ...s.accountBalances, [ownerKey]: creditedBalance }
            : s.accountBalances
          return {
            accountBalances,
            balance: approved && s.user && accountKey(s.user) === ownerKey && !ownerIsMainAdmin
              ? creditedBalance
              : s.balance,
            depositRequests: s.depositRequests.map((item) => item.id === id
              ? { ...item, status: approved ? 'approved' : 'rejected' }
              : item),
            ledger: approved ? [{
              id: uid('led'), at: new Date().toISOString(), label: 'Deposit approved', amount: request.amount,
              accountName: request.user,
            }, ...s.ledger] : s.ledger,
          }
        }),
      reviewWithdrawal: (id, approved, payoutAmount = 0) =>
        set((s) => {
          const request = s.withdrawalRequests.find((item) => item.id === id && item.status === 'pending')
          if (!request) return s
          const ownerKey = accountKey(request.user)
          const ownerBalance = s.accountBalances[ownerKey] ?? 0
          const ownerIsMainAdmin = s.isUnlimited && accountKey(s.user) === ownerKey
          const refundedBalance = round2(ownerBalance + request.amount)
          const accountBalances = !approved && !ownerIsMainAdmin
            ? { ...s.accountBalances, [ownerKey]: refundedBalance }
            : s.accountBalances
          return {
            accountBalances,
            balance: !approved && s.user && accountKey(s.user) === ownerKey && !ownerIsMainAdmin
              ? refundedBalance
              : s.balance,
            withdrawalRequests: s.withdrawalRequests.map((item) => item.id === id
              ? { ...item, payoutAmount: approved ? round2(payoutAmount) : undefined, status: approved ? 'approved' : 'rejected' }
              : item),
            ledger: approved ? s.ledger : [{
              id: uid('led'), at: new Date().toISOString(), label: 'Withdrawal request rejected', amount: request.amount,
              accountName: request.user,
            }, ...s.ledger],
          }
        }),
      addPaymentQr: (name, image) =>
        set((s) => s.paymentQrs.length >= 5 ? s : {
          paymentQrs: [...s.paymentQrs, { id: uid('qr'), name, image }],
        }),
      removePaymentQr: (id) => set((s) => ({ paymentQrs: s.paymentQrs.filter((qr) => qr.id !== id) })),
      setMainAdmin: (name) => set((s) => {
        if (s.mainAdmin) return s
        const normalizedName = name.trim()
        return {
          mainAdmin: normalizedName || null,
          ...(s.user && accountKey(s.user) === accountKey(normalizedName)
            ? { balance: UNLIMITED_BALANCE }
            : {}),
          customers: s.customers.filter((customer) => customer.name.toLowerCase() !== normalizedName.toLowerCase()),
        }
      }),
      setStakeOptions: (options) => {
        if (options.length !== 6 || options.some((amount) => !Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000)
          || new Set(options).size !== 6) {
          return 'Enter six unique whole-number stakes between 1 and 1,000,000 coins.'
        }
        set({ stakeOptions: [...options] })
        return null
      },
      transferCoins: async (recipientId, amount) => {
        const response = await fetch('/api/coin-transfers', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipientId, amount }),
        })
        const result = await response.json() as { error?: string; profile?: AccountProfile }
        if (!response.ok) return result.error ?? 'Could not transfer coins.'
        if (!result.profile) return 'Transfer succeeded, but the updated account balance was missing.'
        get().setServerProfile(result.profile)
        return null
      },
      setServerProfile: (profile) => set((state) => ({
        user: profile.user,
        playerId: profile.playerId,
        role: profile.role,
        isUnlimited: profile.isUnlimited,
        permissions: profile.permissions,
        authReady: true,
        balance: profile.balance,
        accountBalances: { ...state.accountBalances, [accountKey(profile.user)]: profile.balance },
        bets: profile.bets ?? state.bets,
        ledger: profile.ledger ?? state.ledger,
        settled: profile.settled ?? state.settled,
        events: profile.settled ? applySettled(EVENTS, profile.settled) : state.events,
      })),
      clearSession: () => set({
        user: null, playerId: null, role: null, isUnlimited: false, permissions: {}, authReady: true, balance: 0,
      }),
      replaceStaff: (staff) => set({ staff }),
      addStaffMember: (name, role, permissions) =>
        {
          let employeeId = ''
          const activationCode = crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()
          set((s) => {
            do {
              employeeId = `SHR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
            } while (s.staff.some((member) => member.employeeId === employeeId))
            const accountBalances = role === 'ceo'
              ? { ...s.accountBalances, [accountKey(name)]: CEO_STARTING_BALANCE }
              : s.accountBalances
            return { accountBalances, staff: [...s.staff, {
              id: uid('staff'), employeeId, name: name.trim(), role, permissions,
              status: 'invited', activationCode,
            }] }
          })
          return { employeeId, activationCode }
        },
      activateStaff: (employeeId, activationCode) => {
        const member = get().staff.find((item) => item.employeeId.toLowerCase() === employeeId.trim().toLowerCase())
        if (!member || member.status !== 'invited' || member.activationCode !== activationCode.trim().toUpperCase()) {
          return 'Invitation name or activation code is incorrect.'
        }
        set((s) => ({ staff: s.staff.map((item) => item.id === member.id
          ? { ...item, status: 'active', activationCode: '' }
          : item) }))
        return null
      },
      setStaffStatus: (id, status) =>
        set((s) => ({ staff: s.staff.map((member) => member.id === id ? { ...member, status } : member) })),
      updateStaffPermissions: (id, permissions) =>
        set((s) => ({ staff: s.staff.map((member) => member.id === id ? { ...member, permissions } : member) })),
      removeStaffMember: (id) => set((s) => ({ staff: s.staff.filter((member) => member.id !== id) })),
      assignCustomer: (customerId, employeeId) =>
        set((s) => {
          if (employeeId && !s.staff.some((member) => member.employeeId === employeeId && member.status === 'active')) return s
          return { customers: s.customers.map((customer) => customer.id === customerId
            ? { ...customer, assignedEmployeeId: employeeId }
            : customer) }
        }),
      settleMarket: (eventId, marketId, winnerId) =>
        set((s) => {
          const event = s.events.find((e) => e.id === eventId)
          const market = event?.markets.find((m) => m.id === marketId)
          if (!event || !market || market.settledRunnerId) return s
          let balance = s.balance
          let accountBalances = s.accountBalances
          const ledger: LedgerEntry[] = []
          const bets = s.bets.map((bet) => {
            if (bet.marketId !== marketId || bet.status !== 'open') return bet
            const backedWinner = bet.side === 'back' && bet.runnerId === winnerId
            const laidLoser = bet.side === 'lay' && bet.runnerId !== winnerId
            const won = backedWinner || laidLoser
            const pnl = won ? potentialWin(bet.side, bet.odds, bet.stake) : -bet.liability
            const owner = bet.customerName ?? s.user ?? 'Player'
            if (won) {
              const returned = round2(bet.liability + potentialWin(bet.side, bet.odds, bet.stake))
              if (!(s.isUnlimited && accountKey(s.user) === accountKey(owner))) {
                const ownerKey = accountKey(owner)
                const ownerBalance = accountBalances[ownerKey] ?? 0
                const creditedBalance = round2(ownerBalance + returned)
                accountBalances = { ...accountBalances, [ownerKey]: creditedBalance }
                if (s.user && accountKey(s.user) === ownerKey) balance = creditedBalance
              }
              ledger.push({
                id: uid('led'),
                at: new Date().toISOString(),
                label: `Won ${bet.runnerName} @ ${bet.odds}`,
                amount: returned,
                accountName: owner,
              })
            } else {
              ledger.push({
                id: uid('led'),
                at: new Date().toISOString(),
                label: `Lost ${bet.runnerName} @ ${bet.odds}`,
                amount: 0,
                accountName: owner,
              })
            }
            return { ...bet, status: won ? 'won' : 'lost', pnl } satisfies Bet
          })
          return {
            balance,
            accountBalances,
            bets,
            ledger: [...ledger, ...s.ledger],
            settled: { ...s.settled, [marketId]: winnerId },
            events: s.events.map((ev) =>
              ev.id !== eventId
                ? ev
                : {
                    ...ev,
                    markets: ev.markets.map((m) =>
                      m.id === marketId ? { ...m, settledRunnerId: winnerId } : m,
                    ),
                  },
            ),
          }
        }),
    }),
    {
      name: 'sherabet-demo',
      version: 5,
      migrate: (persisted, version) => {
        const saved = (persisted ?? {}) as Partial<State>
        let migrated = saved
        if (version < 2) {
          const ledger = saved.ledger ?? []
          const grantEntries = ledger.filter((entry) => /^(opening credits|daily credit bonus)$/i.test(entry.label))
          const freeCoins = grantEntries.reduce((total, entry) => total + entry.amount, 0)
          migrated = {
            ...migrated,
            balance: Math.max(0, (saved.balance ?? 0) - freeCoins),
            ledger: ledger.filter((entry) => !/^(opening credits|daily credit bonus)$/i.test(entry.label)),
          }
        }
        if (version < 3) {
          migrated = {
            ...migrated,
            staff: (saved.staff ?? []).map((member) => ({
              ...member,
              employeeId: member.employeeId || `SHR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
              status: member.status ?? 'invited',
              activationCode: member.activationCode ?? crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase(),
            })),
          }
        }
        if (version < 4) migrated = { ...migrated, customers: saved.customers ?? [] }
        if (version < 5) {
          const accountBalances = { ...(saved.accountBalances ?? {}) }
          if (saved.user) accountBalances[accountKey(saved.user)] = saved.balance ?? 0
          for (const member of saved.staff ?? []) {
            if (member.role === 'ceo' && accountBalances[accountKey(member.name)] === undefined) {
              accountBalances[accountKey(member.name)] = CEO_STARTING_BALANCE
            }
          }
          migrated = {
            ...migrated,
            accountBalances,
            stakeOptions: DEFAULT_STAKE_OPTIONS,
            bets: (saved.bets ?? []).map((bet) => ({
              ...bet,
              customerName: bet.customerName ?? saved.user ?? 'Player',
            })),
            ledger: (saved.ledger ?? []).map((entry) => ({
              ...entry,
              accountName: entry.accountName ?? saved.user ?? 'Player',
            })),
          }
        }
        return {
          ...migrated,
        } as State
      },
      partialize: (s) => ({
        user: s.user,
        balance: s.balance,
        accountBalances: s.accountBalances,
        stakeOptions: s.stakeOptions,
        bets: s.bets,
        ledger: s.ledger,
        settled: s.settled,
        depositRequests: s.depositRequests,
        withdrawalRequests: s.withdrawalRequests,
        paymentQrs: s.paymentQrs,
        customers: s.customers,
        staff: s.staff,
      }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<State>
        const settled = saved.settled ?? {}
        return {
          ...current,
          ...saved,
          user: null,
          playerId: null,
          role: null,
          isUnlimited: false,
          permissions: {},
          authReady: false,
          balance: 0,
          accountBalances: {},
          stakeOptions: saved.stakeOptions ?? DEFAULT_STAKE_OPTIONS,
          mainAdmin: null,
          ledger: (saved.ledger ?? current.ledger).map((entry) => ({
            ...entry,
            label: entry.label.replace(/\bvirtual\b/gi, 'credits').replace(/\bdemo\b/gi, 'credits'),
          })),
          settled,
          events: applySettled(EVENTS, settled),
        }
      },
    },
  ),
)
export function sideLabel(side: Side) {
  return side === 'back' ? 'Back' : 'Lay'
}