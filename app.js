import { storySegments, voices } from './data.js';

const appState = {
    currentSegment: -1,
    isPlaying: false,
    audioQueue: [],
    selectedVoice: voices.find(v => v.name === "Rachel")?.voice_id || voices[0].voice_id
};

// DOM Elements
const container = document.getElementById('story-container');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const voiceSelect = document.getElementById('voice-select');
const statusBar = document.getElementById('status-bar');

// Initialize
function init() {
    // Populate Voice Select
    voices.forEach(voice => {
        const option = document.createElement('option');
        option.value = voice.voice_id;
        option.textContent = voice.name;
        if (voice.voice_id === appState.selectedVoice) option.selected = true;
        voiceSelect.appendChild(option);
    });

    voiceSelect.addEventListener('change', (e) => {
        appState.selectedVoice = e.target.value;
    });

    // Render segments
    storySegments.forEach((segment, index) => {
        const segDiv = document.createElement('div');
        segDiv.className = 'story-segment';
        segDiv.id = `segment-${index}`;

        const imgContainer = document.createElement('div');
        imgContainer.className = 'segment-image-container';
        imgContainer.id = `img-container-${index}`;

        const placeholder = document.createElement('div');
        placeholder.className = 'image-placeholder';
        placeholder.textContent = 'Illustration will appear here...';
        imgContainer.appendChild(placeholder);

        const textP = document.createElement('div');
        textP.className = 'segment-text';
        textP.textContent = segment.text;

        segDiv.appendChild(imgContainer);
        segDiv.appendChild(textP);
        container.appendChild(segDiv);
    });

    startBtn.addEventListener('click', startStory);
    stopBtn.addEventListener('click', stopStory);
}

async function generateAudio(text, voiceId) {
    try {
        const result = await websim.textToSpeech({
            text: text,
            voice: voiceId
        });
        return result.url;
    } catch (e) {
        console.error("Audio gen failed", e);
        statusBar.textContent = "Error generating audio...";
        return null;
    }
}

async function generateImage(prompt, containerId) {
    const container = document.getElementById(containerId);
    if (!container || container.querySelector('img')) return; // Already exists or container gone

    const placeholder = container.querySelector('.image-placeholder');
    if (placeholder) placeholder.innerHTML = '<div class="loader"></div>';

    try {
        const result = await websim.imageGen({
            prompt: prompt,
            aspect_ratio: "16:9"
        });

        const img = new Image();
        img.src = result.url;
        img.className = 'segment-image';
        img.onload = () => img.classList.add('loaded');

        container.innerHTML = '';
        container.appendChild(img);
    } catch (e) {
        console.error("Image gen failed", e);
        if (placeholder) placeholder.textContent = "Failed to visualize.";
    }
}

async function playSegment(index) {
    if (!appState.isPlaying) return;
    if (index >= storySegments.length) {
        stopStory();
        statusBar.textContent = "The End.";
        return;
    }

    appState.currentSegment = index;

    // UI Updates
    document.querySelectorAll('.story-segment').forEach(el => el.classList.remove('active'));
    const currentEl = document.getElementById(`segment-${index}`);
    if (currentEl) {
        currentEl.classList.add('active');
        currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Trigger Image Gen for this segment (and next if possible)
    const currentData = storySegments[index];
    generateImage(currentData.imagePrompt, `img-container-${index}`);

    // Pre-load next image
    if (index + 1 < storySegments.length) {
         // Small delay to prioritize audio request
         setTimeout(() => {
             if(appState.isPlaying) generateImage(storySegments[index+1].imagePrompt, `img-container-${index+1}`);
         }, 2000);
    }

    // Audio Logic
    statusBar.textContent = "Generating narration...";
    const audioUrl = await generateAudio(currentData.text, appState.selectedVoice);

    if (!audioUrl || !appState.isPlaying) return;

    statusBar.textContent = "Narrating...";
    const audio = new Audio(audioUrl);

    audio.onended = () => {
        playSegment(index + 1);
    };

    audio.play();
    appState.currentAudio = audio; // Store reference to stop it later
}

function startStory() {
    appState.isPlaying = true;
    startBtn.hidden = true;
    stopBtn.hidden = false;
    voiceSelect.disabled = true;

    // Start from beginning or resume? Let's start from 0 for simplicity or where we left off
    const startIndex = appState.currentSegment > -1 ? appState.currentSegment : 0;
    playSegment(startIndex);
}

function stopStory() {
    appState.isPlaying = false;
    startBtn.hidden = false;
    stopBtn.hidden = true;
    voiceSelect.disabled = false;
    statusBar.textContent = "Stopped.";

    if (appState.currentAudio) {
        appState.currentAudio.pause();
        appState.currentAudio = null;
    }
}

init();