CREATE TABLE "ProvisioningRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "callInIdentityId" TEXT NOT NULL,
    "gmail" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,
    "needsGoogleTestUser" BOOLEAN NOT NULL DEFAULT true,
    "googleTestUserEnabled" BOOLEAN NOT NULL DEFAULT false,
    "provisionedReady" BOOLEAN NOT NULL DEFAULT false,
    "connectedTipSpoken" BOOLEAN NOT NULL DEFAULT false,
    "connectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProvisioningRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProvisioningRequest_callInIdentityId_key"
ON "ProvisioningRequest"("callInIdentityId");

CREATE UNIQUE INDEX "ProvisioningRequest_shortCode_key"
ON "ProvisioningRequest"("shortCode");

CREATE INDEX "ProvisioningRequest_organizationId_workspaceId_idx"
ON "ProvisioningRequest"("organizationId", "workspaceId");

CREATE INDEX "ProvisioningRequest_userId_provisionedReady_idx"
ON "ProvisioningRequest"("userId", "provisionedReady");

CREATE INDEX "ProvisioningRequest_needsGoogleTestUser_googleTestUserEnabled_createdAt_idx"
ON "ProvisioningRequest"("needsGoogleTestUser", "googleTestUserEnabled", "createdAt");

CREATE INDEX "ProvisioningRequest_phoneE164_idx"
ON "ProvisioningRequest"("phoneE164");
