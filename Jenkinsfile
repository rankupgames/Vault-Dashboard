@Library('homelab') _

// Canonical loader for automatically registered checks. Jenkins pins this exact file by SHA-256.
// The job SCM supplies the repository, credential and branch. .rug-service/ci.json supplies the check.
homelabPipeline(
    agentLabel: 'homelab-dev3-linux', branch: 'main', branchFromScm: true,
    sourceRepository: scm.userRemoteConfigs[0].url,
    scmCredentialId: scm.userRemoteConfigs[0].credentialsId,
    sourceRevisionParameter: 'SOURCE_SHA', scriptPath: 'Jenkinsfile',
    pipelineRevision: params.SOURCE_SHA, timeoutMinutes: 90,
    recipe: true, disposableAgentLabel: 'instabox-runtime-linux',
    actions: [local: [profiles: ['small-web']]]
)
