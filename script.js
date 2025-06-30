<script type="module">
    import { PoseLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.skypack.dev/@mediapipe/tasks-vision@0.10.12";

    // --- DOM 요소 참조 ---
    const getElement = id => document.getElementById(id);
    const videoUpload = getElement("videoUpload"), video = getElement("analysisVideo"), canvasElement = getElement("output_canvas"), videoContainer = getElement("videoContainer"), statusElement = getElement("status"), feedbackList = getElement("feedbackList"), shareStoryBtn = getElement("shareStoryBtn"), uploadSection = getElement('upload-section'), analysisSection = getElement('analysis-section'), resultSection = getElement('result-section'), storyCanvas = getElement('story-canvas'), coachFeedbackArea = getElement('coach-feedback-area'), storyCanvasContainer = getElement('story-canvas-container'), startAnalysisBtn = getElement('startAnalysisBtn'), resetBtn = getElement('resetBtn'), noSquatResultArea = getElement('no-squat-result-area'), initialStatus = getElement('initial-status');
    const canvasCtx = canvasElement.getContext("2d"), storyCtx = storyCanvas.getContext('2d');

    // --- 전역 상태 변수 ---
    let poseLandmarker, animationFrameId;
    let bestMomentTime = 0, lowestKneeAngle = 180;

    // --- 유틸리티 함수 ---
    const calculateAngle = (p1, p2, p3) => Math.acos(Math.max(-1, Math.min(1, ((p1.x - p2.x) * (p3.x - p2.x) + (p1.y - p2.y) * (p3.y - p2.y)) / (Math.sqrt((p1.x - p2.x)**2 + (p1.y - p2.y)**2) * Math.sqrt((p3.x - p2.x)**2 + (p3.y - p2.y)**2))))) * (180 / Math.PI);
    const getQualitativeFeedback = score => { if (score >= 90) return "완벽에 가까운 스쿼트! 자세 교본으로 써도 되겠어요. 👏"; if (score >= 80) return "훌륭해요! 안정적인 자세가 돋보입니다. 여기서 만족하지 않으실 거죠? 😉"; if (score >= 70) return "좋아요! 기본기가 탄탄하시네요. 조금만 더 깊이에 신경 쓰면 완벽할 거예요."; if (score >= 50) return "잘하고 있어요! 조금만 더 꾸준히 하면 금방 좋아질 거예요. 화이팅!"; if (score >= 30) return "음, 이게 스쿼트일까요? 🕺 열정은 100점! 자세는 우리와 함께 만들어가요!"; return "앗, 앉으려다 마신 건 아니죠? 😅 괜찮아요, 모든 시작은 미약하니까요!"; };
    
    // --- 스쿼트 분석 클래스 ---
    class SquatAnalyzer {
        constructor() {
            this.reset();
        }
        reset() {
            this.squatCount = 0; this.squatPhase = 'standing'; this.frameCount = 0;
            this.totalScores = { depth: 0, backPosture: 0 };
            this.repReachedMinDepth = false;
        }
        analyze(landmarks) {
            const pose = landmarks[0];
            if (!pose) return;

            const hip = {x:(pose[23].x+pose[24].x)/2, y:(pose[23].y+pose[24].y)/2};
            const knee = {x:(pose[25].x+pose[26].x)/2, y:(pose[25].y+pose[26].y)/2};
            const shoulder = {x:(pose[11].x+pose[12].x)/2, y:(pose[11].y+pose[12].y)/2};
            
            const kneeAngle = (calculateAngle(pose[23], pose[25], pose[27]) + calculateAngle(pose[24], pose[26], pose[28])) / 2;
            if (kneeAngle < lowestKneeAngle) { lowestKneeAngle = kneeAngle; bestMomentTime = video.currentTime; }
            
            const vertical = { x: hip.x, y: hip.y - 1 };
            const torsoAngle = calculateAngle(shoulder, hip, vertical);
            
            let depthScore = 0; if (kneeAngle <= 90) depthScore = 100; else if (kneeAngle <= 110) depthScore = Math.max(0, 100 - (kneeAngle - 90) * 2.5); else depthScore = Math.max(0, 50 - (kneeAngle - 110) * 1.5);
            let backScore = 0; if (torsoAngle > 10 && torsoAngle < 50) backScore = 100; else if (torsoAngle <= 10) backScore = Math.max(0, 100 - (10 - torsoAngle) * 5); else backScore = Math.max(0, 100 - (torsoAngle - 50) * 3);
            if (kneeAngle <= 120) this.repReachedMinDepth = true;
            
            if (this.squatPhase === 'standing' && kneeAngle < 160) {
                this.squatPhase = 'descending'; this.repReachedMinDepth = false; this.frameCount = 0; this.totalScores = { depth: 0, backPosture: 0 };
            } else if (this.squatPhase === 'descending' && kneeAngle < 100) {
                this.squatPhase = 'bottom';
            } else if ((this.squatPhase === 'bottom' || this.squatPhase === 'descending') && kneeAngle >= 100 && kneeAngle < 160) {
                this.squatPhase = 'ascending';
            } else if (this.squatPhase === 'ascending' && kneeAngle >= 160) {
                if (this.repReachedMinDepth && this.frameCount > 5) this.squatCount++;
                this.squatPhase = 'standing';
            }
            if (this.squatPhase !== 'standing') { this.frameCount++; this.totalScores.depth += depthScore; this.totalScores.backPosture += backScore; }
        }
    }
    const squatAnalyzer = new SquatAnalyzer();

    // --- 메인 애플리케이션 흐름 ---
    async function initialize() {
        updateStatus('AI 모델을 로딩중입니다...', true);
        try {
            const filesetResolver = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm");
            poseLandmarker = await PoseLandmarker.createFromOptions(filesetResolver, { baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`, delegate: "GPU" }, runningMode: "VIDEO", numPoses: 1 });
            initialStatus.textContent = 'AI 모델 준비 완료! 분석할 영상을 선택해주세요.';
        } catch (error) {
            console.error("모델 로딩 실패:", error);
            initialStatus.textContent = '❌ 모델 로딩 실패. 새로고침 해주세요.';
        }
    }

    function resetApp() {
        squatAnalyzer.reset();
        bestMomentTime = 0; lowestKneeAngle = 180; analysisStarted = false;
        uploadSection.style.display = 'block'; analysisSection.style.display = 'none'; resultSection.style.display = 'none';
        startAnalysisBtn.disabled = false; startAnalysisBtn.textContent = "이 영상으로 분석 시작하기 🔬";
        if (video.src) { video.pause(); video.removeAttribute('src'); video.load(); }
        if (animationFrameId) { cancelAnimationFrame(animationFrameId); animationFrameId = null; }
    }

    function handleVideoUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        uploadSection.style.display = 'none';
        analysisSection.style.display = 'block';
        const fileURL = URL.createObjectURL(file);
        video.src = fileURL;
        video.play();
    }

    function setupVideoDisplay() {
        const aspectRatio = video.videoWidth / video.videoHeight;
        let newWidth = videoContainer.clientWidth;
        let newHeight = newWidth / aspectRatio;
        videoContainer.style.height = `${newHeight}px`;
        canvasElement.width = newWidth;
        canvasElement.height = newHeight;
        gameLoop();
    }
    
    function startAnalysis() {
        analysisStarted = true;
        startAnalysisBtn.disabled = true;
        startAnalysisBtn.textContent = "분석 중...";
        video.loop = false;
        video.currentTime = 0;
        video.play();
    }

    async function endAnalysis() {
        updateStatus('✅ 분석 완료!');
        if (animationFrameId) { cancelAnimationFrame(animationFrameId); animationFrameId = null; }
        analysisSection.style.display = 'none';
        resultSection.style.display = 'block';

        if (squatAnalyzer.squatCount > 0 && squatAnalyzer.frameCount > 0) {
            const finalScores = { depth: Math.round(squatAnalyzer.totalScores.depth / squatAnalyzer.frameCount), backPosture: Math.round(squatAnalyzer.totalScores.backPosture / squatAnalyzer.frameCount) };
            const finalTotalScore = Math.round((finalScores.depth + finalScores.backPosture) / 2);
            const qualitativeFeedback = getQualitativeFeedback(finalTotalScore);
            await createShareableImage(finalTotalScore, qualitativeFeedback);
            feedbackList.textContent = qualitativeFeedback;
            google.script.run.withSuccessHandler(r => console.log("시트 기록 성공:",r)).withFailureHandler(e => console.error("시트 기록 실패:",e)).logSquatData({ squatCount: squatAnalyzer.squatCount, totalScore: finalTotalScore, ...finalScores });
        } else {
            showNoSquatResults();
        }
    }
    
    function gameLoop() {
        if (!video.ended) {
            canvasCtx.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);
            if (analysisStarted && poseLandmarker) {
                poseLandmarker.detectForVideo(video, performance.now(), (result) => {
                    const drawingUtils = new DrawingUtils(canvasCtx);
                    if (result.landmarks && result.landmarks.length > 0) {
                        drawingUtils.drawLandmarks(result.landmarks[0], {color: '#FFC107', lineWidth: 2});
                        drawingUtils.drawConnectors(result.landmarks[0], PoseLandmarker.POSE_CONNECTIONS, {color: '#FFFFFF', lineWidth: 2});
                        squatAnalyzer.analyze(result.landmarks);
                    }
                });
            }
            animationFrameId = requestAnimationFrame(gameLoop);
        } else {
            if (analysisStarted) endAnalysis();
        }
    }

    // --- 이벤트 리스너 설정 ---
    videoUpload.addEventListener('change', handleVideoUpload);
    video.addEventListener('loadeddata', setupVideoDisplay);
    startAnalysisBtn.addEventListener('click', (event) => { event.preventDefault(); startAnalysis(); });
    resetBtn.addEventListener('click', (event) => { event.preventDefault(); videoUpload.value = ''; resetApp(); });
    shareStoryBtn.addEventListener('click', (event) => { event.preventDefault(); const dataURL = storyCanvas.toDataURL('image/png'); const link = document.createElement('a'); link.download = `squat-analysis-story-${Date.now()}.png`; link.href = dataURL; link.click(); });
    
    // --- 앱 초기화 ---
    document.addEventListener('DOMContentLoaded', initialize);
</script>
