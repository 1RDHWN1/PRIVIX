const voiceState = {
  selfId: "",
  isVoiceChannel: false,
  serverId: null,
  channelName: "",
  contextKey: "",
  canSpeak: true,
  isReady: false,
  isConnected: false,
  isJoined: false,
  joinedAtTs: 0,
  serverClockOffsetMs: 0,
  isConnecting: false,
  isMuted: false,
  isCameraEnabled: false,
  isCameraBusy: false,
  isScreenSharing: false,
  isScreenShareBusy: false,
  restoreCameraAfterJoin: false,
  restoreCameraAfterScreenShare: false,
  manualLeave: false,
  iceFailureNotified: false,
  audioPlaybackPromptShown: false,
  outputDeviceFailureNotified: false,
  meshTurnWarningShown: false,
  meshScaleWarningShown: false,
  audioContext: null,
  analyserLoopId: 0,
  presenceTimerId: 0,
  lastPresenceKey: "",
  presenceIds: new Set(),
  presenceInitialized: false,
  channelPresenceByKey: new Map(),
  analysers: new Map(),
  speakingState: new Map(),
  tileEls: new Map(),
  stageLayoutMode: "grid",
  stageFocusId: "",
  stageFocusLockUntil: 0,
  expandedScreenShareId: "",
  rawStream: null,
  localStream: null,
  localCameraStream: null,
  localCameraTrack: null,
  localScreenStream: null,
  localScreenTrack: null,
  inputGainNode: null,
  inputSourceNode: null,
  inputDeviceId: "",
  cameraDeviceId: "",
  cameraFacingMode: "user",
  preferCameraFacingMode: false,
  cameraQualityMode: "auto",
  cameraAppliedProfile: "balanced",
  availableCameraCount: 0,
  canFlipCamera: false,
  lastCameraAutoTuneAt: 0,
  isCameraQualityApplying: false,
  outputDeviceId: "",
  outputVolume: 0.8,
  inputGain: 1,
  voiceMode: "mesh",
  pushToTalkEnabled: false,
  pushToTalkKey: "KeyV",
  pushToTalkActive: false,
  wasMutedBeforePtt: false,
  isCapturingPttKey: false,
  peers: new Map(),
  peerMeta: new Map(),
  peerStats: new Map(),
  qualityTimerId: 0,
  qualitySummary: {
    level: "Unknown",
    rttMs: 0,
    jitterMs: 0,
    lossPct: 0,
    updatedAt: 0
  },
  audioEls: new Map(),
  mediaStreams: new Map(),
  mediaStreamsBySource: new Map(),
  sfuRoom: null,
  sfuLocalTracks: {
    audio: null,
    camera: null,
    screen: null
  },
  sfuTrackBindings: new Map(),
  sfuSdkModule: null,
  sfuSdkPromise: null,
  lastSfuError: "",
  participants: new Map()
}

function resetVoiceStageState() {
  voiceState.tileEls.clear()
  voiceState.stageFocusId = ""
  voiceState.stageFocusLockUntil = 0
  voiceState.expandedScreenShareId = ""
}

function resetVoiceMediaCollections() {
  voiceState.mediaStreams.clear()
  voiceState.mediaStreamsBySource.clear()
  voiceState.peerStats.clear()
  voiceState.audioEls.forEach((audio) => {
    try {
      audio.pause()
      audio.srcObject = null
      audio.remove()
    } catch {}
  })
  voiceState.audioEls.clear()
}

function resetVoiceTransientFlags() {
  voiceState.isConnecting = false
  voiceState.isJoined = false
  voiceState.joinedAtTs = 0
  voiceState.serverClockOffsetMs = 0
  voiceState.isCameraBusy = false
  voiceState.isScreenShareBusy = false
  voiceState.isScreenSharing = false
  voiceState.restoreCameraAfterScreenShare = false
  voiceState.pushToTalkActive = false
  voiceState.voiceMode = "mesh"
  resetVoiceStageState()
}

export {
  voiceState,
  resetVoiceStageState,
  resetVoiceMediaCollections,
  resetVoiceTransientFlags
}
