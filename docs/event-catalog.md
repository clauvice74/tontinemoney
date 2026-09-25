# Catalogue des événements

Source de vérité exécutable : `packages/events/src/catalog.ts` (schéma zod par type et par version). Ce document en est la vue lisible.

## Enveloppe

```json
{
  "eventId": "uuid v4",
  "eventType": "tontine.cycle.started",
  "eventVersion": 1,
  "occurredAt": "2026-09-24T12:00:00.000Z",
  "correlationId": "id de la requête HTTP ou du job d'origine",
  "causationId": "eventId de l'événement qui a causé celui-ci, sinon null",
  "producer": "tontines",
  "aggregateType": "tontine",
  "aggregateId": "uuid",
  "payload": {}
}
```

Règles :

- Versionnement : un changement incompatible crée `eventVersion + 1` ; les consommateurs déclarent les versions supportées.
- Les montants sont transmis en unités mineures sous forme de chaîne (`"50000"`) avec la devise.
- Aucun secret (jeton, OTP, mot de passe) ni document dans un payload.
- Publication uniquement via l'outbox, dans la transaction SQL qui produit le changement.
- Topic Kafka = `eventType` ; clé de partition = `aggregateId`.

## Événements (v1)

| Événement                                   | Producteur            | Payload                                                                                           | Consommateurs                              |
| ------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `user.registered`                           | auth                  | userId, firstName, lastName, email?, phone?, country?, language?, role, registeredBy?, tontineId? | members, notifications                     |
| `user.approval.requested`                   | auth                  | userId, requestId, requestedTontineId?                                                            | notifications                              |
| `user.activated`                            | auth                  | userId                                                                                            | members                                    |
| `user.login`                                | auth                  | userId, ip, userAgent, mfaUsed, newDevice                                                         | notifications (nouveau device)             |
| `user.logout`                               | auth                  | userId, sessionId                                                                                 | —                                          |
| `user.locked`                               | auth                  | userId, reason, attemptCount                                                                      | notifications                              |
| `user.password.reset`                       | auth                  | userId                                                                                            | notifications                              |
| `user.mfa.enabled` / `user.mfa.disabled`    | auth                  | userId, mfaType                                                                                   | notifications                              |
| `user.access.decided`                       | auth                  | userId, requestId, decision, reason?                                                              | notifications                              |
| `member.created`                            | members               | memberId, country, language, status                                                               | wallets, kyc                               |
| `member.updated`                            | members               | memberId, changedFields[], oldValues, newValues                                                   | compliance (pays)                          |
| `member.status.changed`                     | members               | memberId, oldStatus, newStatus, reason, changedBy                                                 | auth, tontines                             |
| `member.kyc.required`                       | members               | memberId                                                                                          | notifications                              |
| `member.suspended`                          | members               | memberId, reason, suspendedBy                                                                     | auth, tontines, wallets                    |
| `kyc.submitted`                             | kyc                   | memberId, requestId, kycLevel, documentTypes[]                                                    | members, kyc (pipeline)                    |
| `kyc.verified`                              | kyc                   | memberId, requestId, kycLevel, verifiedAt, verifiedBy                                             | members, notifications                     |
| `kyc.rejected`                              | kyc                   | memberId, requestId, rejectCategory, rejectReason, rejectedBy                                     | members, notifications                     |
| `kyc.review.required`                       | kyc                   | memberId, requestId, failedSteps[], scores                                                        | members, notifications                     |
| `kyc.expired`                               | kyc                   | memberId, requestId, expirationDate                                                               | members, notifications                     |
| `kyc.expiring`                              | kyc                   | memberId, daysLeft                                                                                | notifications                              |
| `kyc.duplicate.detected`                    | kyc                   | memberId, duplicateOfMemberId, similarityScore                                                    | members, notifications                     |
| `kyc.supplement.requested`                  | kyc                   | memberId, requestId, message                                                                      | notifications                              |
| `tontine.created`                           | tontines              | tontineId, createdBy, type, params                                                                | notifications                              |
| `tontine.invitation.sent`                   | tontines              | tontineId, invitationId, channel, invitedUserId?                                                  | notifications                              |
| `tontine.member.added`                      | tontines              | tontineId, memberId, position                                                                     | notifications                              |
| `tontine.member.removed`                    | tontines              | tontineId, memberId, reason                                                                       | notifications                              |
| `tontine.member.suspended`                  | tontines              | tontineId, memberId, consecutiveDefaults                                                          | notifications                              |
| `tontine.ready`                             | tontines              | tontineId, memberCount                                                                            | notifications                              |
| `tontine.start.blocked`                     | tontines              | tontineId, blockers[]                                                                             | notifications                              |
| `tontine.started`                           | tontines              | tontineId, memberCount, firstBeneficiaryId, drawProof                                             | notifications                              |
| `tontine.cycle.started`                     | tontines              | tontineId, cycleId, cycleNumber, beneficiaryId, dueDate                                           | notifications                              |
| `tontine.contribution.due`                  | tontines              | tontineId, cycleId, contributionId, memberId, amountMinor, currency, dueDate                      | notifications                              |
| `tontine.contribution.received`             | tontines              | tontineId, cycleId, memberId, amountMinor, transactionId                                          | notifications                              |
| `tontine.contribution.late`                 | tontines              | tontineId, cycleId, memberId, penaltyMinor                                                        | notifications                              |
| `tontine.contribution.defaulted`            | tontines              | tontineId, cycleId, memberId                                                                      | notifications                              |
| `tontine.payout.initiated`                  | tontines              | tontineId, cycleId, beneficiaryId, totalMinor, currency                                           | notifications                              |
| `tontine.cycle.completed`                   | tontines              | tontineId, cycleId, cycleNumber, beneficiaryId, totalMinor                                        | notifications                              |
| `tontine.paused` / `tontine.resumed`        | tontines              | tontineId, reason                                                                                 | notifications                              |
| `tontine.closed`                            | tontines              | tontineId, totalCycles, totalMinor                                                                | notifications                              |
| `wallet.created`                            | wallets               | walletId, memberId, currency                                                                      | —                                          |
| `wallet.balance.updated`                    | wallets               | walletId, memberId, oldBalanceMinor, newBalanceMinor, movementType, amountMinor, transactionId    | notifications                              |
| `wallet.hold.created`                       | wallets               | walletId, holdId, amountMinor, context                                                            | —                                          |
| `wallet.hold.released`                      | wallets               | walletId, holdId, amountMinor, outcome (RELEASED/CAPTURED)                                        | —                                          |
| `wallet.hold.expired`                       | wallets               | walletId, holdId, amountMinor, context, referenceId                                               | tontines, payments                         |
| `wallet.debit.failed`                       | wallets               | walletId, memberId, reason, requestedMinor                                                        | notifications                              |
| `wallet.status.changed`                     | wallets               | walletId, oldStatus, newStatus, reason                                                            | —                                          |
| `transaction.initiated`                     | transactions          | txId, type, amountMinor, currency, initiatorId, beneficiaryId, context                            | —                                          |
| `transaction.validated`                     | transactions          | txId                                                                                              | —                                          |
| `transaction.completed`                     | transactions          | txId, completedAt, movementIds[]                                                                  | —                                          |
| `transaction.rejected`                      | transactions          | txId, rejectionRule, rejectionReason                                                              | notifications                              |
| `transaction.failed`                        | transactions          | txId, failureCode, failureReason                                                                  | notifications                              |
| `transaction.reversed`                      | transactions          | txId, reversalTxId, reason                                                                        | notifications                              |
| `payment.initiated`                         | payments              | paymentId, type, method, amountMinor, currency, memberId                                          | notifications                              |
| `payment.processing`                        | payments              | paymentId, provider                                                                               | —                                          |
| `payment.completed`                         | payments              | paymentId, type, memberId, amountMinor, currency, transactionId                                   | notifications                              |
| `payment.failed`                            | payments              | paymentId, type, memberId, reason                                                                 | notifications                              |
| `payment.expired`                           | payments              | paymentId                                                                                         | notifications                              |
| `payment.refunded`                          | payments              | paymentId, refundPaymentId, amountMinor                                                           | notifications                              |
| `compliance.rule.updated`                   | compliance            | ruleCode, country, version, change                                                                | members (réévaluation), compliance (cache) |
| `compliance.violation.detected`             | compliance            | memberId, operationType, ruleCode, action                                                         | notifications                              |
| `compliance.user.restricted`                | compliance            | memberId, reason                                                                                  | members                                    |
| `compliance.user.suspended`                 | compliance            | memberId, reason                                                                                  | members                                    |
| `fraud.user.flagged`                        | administration (A-14) | memberId, reason, flaggedBy                                                                       | members, auth, wallets                     |
| `notification.created`                      | notifications         | notificationId, memberId, type, channel, priority                                                 | —                                          |
| `notification.sent` / `notification.failed` | notifications         | notificationId, channel, attempts                                                                 | —                                          |
| `reconciliation.completed`                  | transactions          | reportId, kind, discrepancies                                                                     | notifications (super-admin)                |
| `report.generated`                          | administration        | reportId, tontineId, kind                                                                         | —                                          |
