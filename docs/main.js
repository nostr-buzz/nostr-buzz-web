// nostr.buzz landing page interactions (moved out of index.html for the CSP-friendly lint rules).
function createParticles() {
  const particlesContainer = document.getElementById('particles');
  particlesContainer.innerHTML = '';

  const isMobile = window.innerWidth <= 768;
  const numberOfParticles = isMobile ? 15 : 40;

  for (let i = 0; i < numberOfParticles; i++) {
    const particle = document.createElement('div');
    particle.classList.add('particle');

    const posX = Math.random() * 100;
    const posY = Math.random() * (isMobile ? 50 : 100) + (isMobile ? 20 : 30);
    const size = Math.random() * (isMobile ? 3 : 6) + (isMobile ? 2 : 2);

    particle.style.left = `${posX}%`;
    particle.style.top = `${posY}%`;
    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    particle.style.opacity = isMobile ? '0.25' : '0.3';

    const delay = Math.random() * (isMobile ? 5 : 10);
    const duration = Math.random() * (isMobile ? 10 : 15) + (isMobile ? 8 : 10);
    particle.style.animationDelay = `${delay}s`;
    particle.style.animationDuration = `${duration}s`;

    particlesContainer.appendChild(particle);
  }
}

const logoContainer = document.querySelector('.logo-container');
logoContainer.addEventListener('mousemove', (e) => {
  const rect = logoContainer.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  logoContainer.style.setProperty('--mouse-x', `${x}px`);
  logoContainer.style.setProperty('--mouse-y', `${y}px`);
});

logoContainer.addEventListener('mouseleave', () => {
  logoContainer.style.setProperty('--mouse-x', `50%`);
  logoContainer.style.setProperty('--mouse-y', `50%`);
});

const ctaButton = document.querySelector('.cta');
const buzzSound = document.getElementById('buzzSound');
const body = document.body;

ctaButton.addEventListener('click', (event) => {
  event.preventDefault();
  buzzSound.currentTime = 0;
  buzzSound.play().catch(error => {
    console.error("Audio playback failed:", error);
  });
  body.classList.add('shake');
  setTimeout(() => {
    body.classList.remove('shake');
  }, 800);
});

const gameArea = document.getElementById('bee-game-area');
const bee = document.getElementById('moving-bee');
const catchMessage = document.getElementById('catch-message');
const scoreDisplay = document.getElementById('score-display');

let beeInterval = null;
let beeCaught = false;
let score = 0;
let currentMoveInterval = 1500; 
const minMoveInterval = 300; 
const intervalDecrease = 100; 

function updateScore() {
    scoreDisplay.textContent = `Score: ${score}`;
}

function moveBee() {
    if (beeCaught) return;

    const areaRect = gameArea.getBoundingClientRect();

    const padding = 20; 
    const beeRect = bee.getBoundingClientRect();

    const maxX = areaRect.width - beeRect.width - (padding * 2);
    const maxY = areaRect.height - beeRect.height - (padding * 2);

    const randomX = Math.max(0, Math.random() * maxX) + padding;
    const randomY = Math.max(0, Math.random() * maxY) + padding;

    const transitionDuration = Math.max(0.1, (currentMoveInterval / 3) / 1000); 
    bee.style.transition = `top ${transitionDuration}s ease-out, left ${transitionDuration}s ease-out`;

    bee.style.left = `${randomX}px`;
    bee.style.top = `${randomY}px`;
}

function startGame() {
    beeCaught = false;
    catchMessage.style.display = 'none';
    bee.style.opacity = 1;
    bee.style.cursor = 'pointer'; 

    if (score === 0) {
        currentMoveInterval = 1500; 
    } else {
        currentMoveInterval = Math.max(minMoveInterval, currentMoveInterval - intervalDecrease);
    }

    updateScore(); 

    if (beeInterval) clearInterval(beeInterval);
    beeInterval = setInterval(moveBee, currentMoveInterval);
    moveBee(); 
}

bee.addEventListener('click', () => {
    if (!beeCaught) {
        beeCaught = true;
        clearInterval(beeInterval);
        score++; 
        updateScore(); 

        catchMessage.style.display = 'block'; 
        bee.style.opacity = 0.6; 
        bee.style.cursor = 'default'; 
    }
});

catchMessage.addEventListener('click', () => {
    if (beeCaught) { 
         startGame();
    }
});

document.addEventListener('DOMContentLoaded', () => {
  createParticles();
  updateScore();
  startGame();

  function handleResize() {
    createParticles();

    if (beeInterval) {
      clearInterval(beeInterval);
      moveBee();
      beeInterval = setInterval(moveBee, currentMoveInterval);
    }
  }

  let resizeTimer;
  window.addEventListener('resize', function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(handleResize, 250);
  });

  const buttons = document.querySelectorAll('.cta, .learn-more');
  buttons.forEach(button => {
    button.addEventListener('touchstart', function() {
      this.style.transform = 'scale(0.95)';
    });

    button.addEventListener('touchend', function() {
      this.style.transform = '';
    });
  });

  const toggleGoalsButton = document.getElementById('toggle-goals');

  toggleGoalsButton.addEventListener('click', function() {
    const developmentSection = document.getElementById('development-roadmap');
    developmentSection.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  });

  // Update CTA button to scroll to Nostr explanation
  const ctaButton = document.querySelector('.cta');
  ctaButton.addEventListener('click', (event) => {
    event.preventDefault();
    const nostrSection = document.getElementById('nostr-explanation');
    nostrSection.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });

    // Still play the buzz sound for fun
    buzzSound.currentTime = 0;
    buzzSound.play().catch(error => {
      console.error("Audio playback failed:", error);
    });
    body.classList.add('shake');
    setTimeout(() => {
      body.classList.remove('shake');
    }, 800);
  });

  setTimeout(() => {
    window.scrollTo(0, 0);
  }, 100);
});

