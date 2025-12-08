import { storySegments, voices } from './data.js';

const room = new WebsimSocket();

const appState = {
    currentSegment: -1,
    isPlaying: false,
    audioQueue: [],
    selectedVoice: voices.find(v => v.name === "Rachel")?.voice_id || voices[0].voice_id,
    currentAudio: null
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

async function generateAudio(text, voiceId, segmentIndex) {
    // 1. Check Cache
    try {
        const cache = await room.collection('narration_cache')
            .filter({ voice_id: voiceId, segment_index: segmentIndex })
            .getList();
            
        const hit = cache.find(r => r.text === text);
        if (hit && hit.audio_url) {
            console.log("Using cached narration for segment", segmentIndex);
            return hit.audio_url;
        }
    } catch (e) {
        console.warn("Cache check failed", e);
    }

    // 2. Generate
    try {
        const result = await websim.textToSpeech({
            text: text,
            voice: voiceId
        });
        
        let finalUrl = result.url;

        // 3. Persist (Upload) & Cache
        try {
            const response = await fetch(finalUrl);
            if (response.ok) {
                const blob = await response.blob();
                const file = new File([blob], `narration_${voiceId}_${segmentIndex}.mp3`, { type: 'audio/mpeg' });
                finalUrl = await websim.upload(file);
                
                await room.collection('narration_cache').create({
                    voice_id: voiceId,
                    segment_index: segmentIndex,
                    text: text,
                    audio_url: finalUrl
                });
            }
        } catch (cacheErr) {
            console.warn("Failed to cache audio, using temporary url", cacheErr);
        }

        return finalUrl;
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
    statusBar.textContent = "Loading narration...";
    const audioUrl = await generateAudio(currentData.text, appState.selectedVoice, index);

    if (!audioUrl) {
        if (appState.isPlaying) {
             console.warn("Audio failed, skipping segment...");
             setTimeout(() => playSegment(index + 1), 2000);
        }
        return;
    }

    if (!appState.isPlaying) return;

    statusBar.textContent = "Narrating...";
    
    if (appState.currentAudio) {
        appState.currentAudio.pause();
        appState.currentAudio = null;
    }

    const audio = new Audio(audioUrl);
    appState.currentAudio = audio;

    audio.onended = () => {
        appState.currentAudio = null;
        playSegment(index + 1);
    };
    
    // Add error handling for playback
    audio.onerror = () => {
        console.error("Playback error");
        if(appState.isPlaying) playSegment(index + 1);
    };

    audio.play().catch(e => {
        console.error("Autoplay prevented or failed", e);
        if(appState.isPlaying) playSegment(index + 1);
    });
}

function startStory() {
    appState.isPlaying = true;
    startBtn.hidden = true;
    stopBtn.hidden = false;
    voiceSelect.disabled = true;

    // Restart if we were at the end
    let startIndex = appState.currentSegment > -1 ? appState.currentSegment : 0;
    if (startIndex >= storySegments.length - 1) startIndex = 0;

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