import { config } from 'config';

const room = new WebsimSocket();

const lobbyDiv = document.getElementById('lobby');
const gameDiv = document.getElementById('game');
const playerListUl = document.getElementById('players');
const hostSettingsDiv = document.getElementById('host-settings');
const cardContextInput = document.getElementById('card-context');
const startGameButton = document.getElementById('start-game-button');
const waitingForHostP = document.getElementById('waiting-for-host');

const blackCardDiv = document.getElementById('black-card');
const submissionsArea = document.getElementById('submissions-area');
const submittedCardsDiv = document.getElementById('submitted-cards');
const handArea = document.getElementById('hand-area');
const whiteCardsDiv = document.getElementById('white-cards');
const czarControlsDiv = document.getElementById('czar-controls');
const winnerDisplayDiv = document.getElementById('winner-display');
const winnerNameSpan = document.getElementById('winner-name');
const winningCardTextSpan = document.getElementById('winning-card-text');
const nextRoundButton = document.getElementById('next-round-button');
const scoreboardUl = document.getElementById('scores');

let conversationHistory = []; 
let isHost = false;
let gameStarted = false;

function updatePlayerList() {
    if (!playerListUl) return;
    playerListUl.innerHTML = '';
    const sortedPeers = Object.values(room.peers).sort((a, b) => a.username.localeCompare(b.username));

    sortedPeers.forEach((peer, index) => {
        const li = document.createElement('li');
        const img = document.createElement('img');
        img.src = peer.avatarUrl;
        img.alt = peer.username;
        img.title = peer.username;
        li.appendChild(img);
        li.appendChild(document.createTextNode(peer.username));
        if (index === 0) { 
            li.appendChild(document.createTextNode(' (Host)'));
        }
        playerListUl.appendChild(li);
    });

    const playerIds = Object.keys(room.peers).sort(); 
    isHost = playerIds.length > 0 && room.clientId === playerIds[0];

    if (!gameStarted) {
        hostSettingsDiv.style.display = isHost ? 'block' : 'none';
        waitingForHostP.style.display = !isHost ? 'block' : 'none';
        startGameButton.disabled = Object.keys(room.peers).length < config.minPlayers;
        if(startGameButton.disabled){
             startGameButton.title = `Need at least ${config.minPlayers} players to start.`;
        } else {
            startGameButton.title = '';
        }
    }
}

async function generateCards(count, type, context = '') {
    const cards = [];
    const prompt = type === 'black'
        ? config.blackCardGenerationPrompt
        : config.whiteCardGenerationPrompt;
    const fullPrompt = prompt + context;

    console.log(`Generating ${count} ${type} cards with context: "${context}"`);

    const batchSize = 5;
    for (let i = 0; i < count; i += batchSize) {
        const currentBatchSize = Math.min(batchSize, count - i);
        try {
             const completion = await websim.chat.completions.create({
                 messages: [
                     { role: "system", content: `You generate ${type} cards for a Cards Against Humanity style game. Generate exactly ${currentBatchSize} distinct card texts, one per line. No extra text, formatting, or numbering. Context: ${context}` },
                     { role: "user", content: `Generate ${currentBatchSize} ${type} card texts.` }
                 ],
                 temperature: config.generationTemperature,
                 max_tokens: config.maxTokens * currentBatchSize, 
             });
             const generatedText = completion.content.trim();
             const lines = generatedText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
             console.log("LLM Response:", generatedText);
             console.log("Parsed lines:", lines);
             cards.push(...lines.slice(0, currentBatchSize)); 

        } catch (error) {
             console.error(`Error generating ${type} cards:`, error);
             for(let j = 0; j < currentBatchSize; j++) {
                 cards.push(`Error Generating ${type} Card ${i + j + 1}`);
             }
        }
         await new Promise(resolve => setTimeout(resolve, 200));
    }

    while (cards.length < count) {
        cards.push(`Placeholder ${type} Card ${cards.length + 1}`);
    }

    console.log(`Generated ${cards.length} ${type} cards.`);
    return cards.slice(0, count); 
}

function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function dealInitialHands(playerIds, whiteDeck) {
    const hands = {};
    playerIds.forEach(playerId => {
        hands[playerId] = {};
        for (let i = 0; i < config.handSize; i++) {
             const cardId = `card_${Date.now()}_${Math.random()}`;
             hands[playerId][cardId] = whiteDeck.pop();
        }
    });
    return hands;
}

function drawCards(hand, whiteDeck, count) {
     const newHand = { ...hand };
     const drawnCards = {};
     for (let i = 0; i < count && whiteDeck.length > 0; i++) {
         const cardId = `card_${Date.now()}_${Math.random()}`;
         const cardText = whiteDeck.pop();
         newHand[cardId] = cardText;
         drawnCards[cardId] = cardText;
     }
     return { updatedHand: newHand, drawnCards };
}

function renderHand() {
    whiteCardsDiv.innerHTML = '';
    const myHand = room.presence[room.clientId]?.hand || {};
    const submittedCardId = room.presence[room.clientId]?.submittedCardId;
    const currentCzarId = room.roomState.currentCzarId;
    const roundState = room.roomState.roundState;

    const canSubmit = room.clientId !== currentCzarId && !submittedCardId && roundState === 'submission';

    Object.entries(myHand).forEach(([cardId, cardText]) => {
        const cardElement = document.createElement('div');
        cardElement.classList.add('card', 'white-card');
        cardElement.textContent = cardText;
        cardElement.dataset.cardId = cardId;

        if (submittedCardId === cardId) {
            cardElement.classList.add('submitted');
        } else if (canSubmit) {
             cardElement.addEventListener('click', handleSubmitCard);
        } else {
            cardElement.style.cursor = 'not-allowed';
        }

        whiteCardsDiv.appendChild(cardElement);
    });
    handArea.style.display = (room.clientId === currentCzarId && roundState === 'submission') ? 'none' : 'block';
}

function renderBlackCard() {
    const blackCardText = room.roomState.currentBlackCard?.text || "Waiting for black card...";
    blackCardDiv.textContent = blackCardText;
}

function renderSubmissions() {
    submittedCardsDiv.innerHTML = '';
    const submissions = room.roomState.submissions || {};
    const roundState = room.roomState.roundState;
    const currentCzarId = room.roomState.currentCzarId;
    const isCzar = room.clientId === currentCzarId;
    const revealOrder = room.roomState.revealOrder || []; 

    submissionsArea.style.display = Object.keys(submissions).length > 0 ? 'block' : 'none';

    const cardsToDisplay = [];

    if (roundState === 'submission') {
         Object.keys(submissions).forEach(playerId => {
             const cardElement = document.createElement('div');
             cardElement.classList.add('card', 'white-card', 'submitted');
             cardElement.textContent = "?"; 
             cardsToDisplay.push(cardElement);
         });
    } else if (roundState === 'judging' || roundState === 'reveal') {
         revealOrder.forEach(playerId => {
              const submission = submissions[playerId];
              if (submission) {
                 const cardElement = document.createElement('div');
                 cardElement.classList.add('card', 'white-card', 'revealed');
                 cardElement.textContent = submission.cardText;
                 cardElement.dataset.playerId = playerId; 
                 cardElement.dataset.cardId = submission.cardId;

                 if (isCzar && roundState === 'judging') {
                     cardElement.addEventListener('click', handleSelectWinner);
                      cardElement.style.cursor = 'pointer';
                 } else {
                      cardElement.style.cursor = 'default';
                 }
                  if(room.roomState.winningSubmission?.cardId === submission.cardId) {
                      cardElement.classList.add('winning');
                  }

                 cardsToDisplay.push(cardElement);
              }
         });

    }

     cardsToDisplay.forEach(cardElement => submittedCardsDiv.appendChild(cardElement));

    czarControlsDiv.style.display = (isCzar && roundState === 'judging') ? 'block' : 'none';

     winnerDisplayDiv.style.display = roundState === 'reveal' ? 'block' : 'none';
     if (roundState === 'reveal') {
         const winnerId = room.roomState.winningSubmission?.playerId;
         const winner = room.peers[winnerId];
         winnerNameSpan.textContent = winner ? winner.username : 'Someone';
         winningCardTextSpan.textContent = room.roomState.winningSubmission?.cardText || '';
         nextRoundButton.style.display = isHost ? 'block' : 'none'; 
     }
}

function renderScoreboard() {
    scoreboardUl.innerHTML = '';
    const scores = room.roomState.scores || {};
    const sortedPlayerIds = Object.keys(room.peers).sort((a, b) => {
        const scoreA = scores[a] || 0;
        const scoreB = scores[b] || 0;
        if (scoreB !== scoreA) {
            return scoreB - scoreA;
        }
        return room.peers[a].username.localeCompare(room.peers[b].username);
    });

    sortedPlayerIds.forEach(playerId => {
        const player = room.peers[playerId];
        if (player) {
            const li = document.createElement('li');
            const nameSpan = document.createElement('span');
            nameSpan.textContent = player.username;
            const scoreSpan = document.createElement('span');
            scoreSpan.classList.add('score');
            scoreSpan.textContent = scores[playerId] || 0;
            li.appendChild(nameSpan);
            li.appendChild(scoreSpan);
            scoreboardUl.appendChild(li);
        }
    });
}

function updateGameUI() {
    if (!room.roomState.gameActive) {
        lobbyDiv.style.display = 'block';
        gameDiv.style.display = 'none';
        gameStarted = false;
        updatePlayerList(); 
    } else {
        lobbyDiv.style.display = 'none';
        gameDiv.style.display = 'block';
        gameStarted = true;
        renderBlackCard();
        renderHand();
        renderSubmissions();
        renderScoreboard();

    }
}

async function handleStartGame() {
    console.log("Attempting to start game...");
    startGameButton.disabled = true; 
    startGameButton.textContent = 'Generating Cards...';

    const playerIds = Object.keys(room.peers);
    if (playerIds.length < config.minPlayers) {
        alert(`Need at least ${config.minPlayers} players to start.`);
        startGameButton.disabled = false;
         startGameButton.textContent = 'Start Game';
        return;
    }

    const generationContext = cardContextInput.value.trim();
    const numWhiteCardsNeeded = playerIds.length * config.handSize + 50; 
    const numBlackCardsNeeded = 20; 

    const [whiteCards, blackCards] = await Promise.all([
        generateCards(numWhiteCardsNeeded, 'white', generationContext),
        generateCards(numBlackCardsNeeded, 'black', generationContext)
    ]);

    if (whiteCards.length < numWhiteCardsNeeded || blackCards.length < numBlackCardsNeeded) {
        console.error("Failed to generate sufficient cards.");
        alert("Error generating cards. Please try again.");
         startGameButton.disabled = false;
         startGameButton.textContent = 'Start Game';
        return; 
    }

    const whiteDeck = shuffleDeck([...whiteCards]);
    const blackDeck = shuffleDeck([...blackCards]);

    const initialHands = dealInitialHands(playerIds, whiteDeck); 
    const initialBlackCard = blackDeck.pop();

    const initialScores = playerIds.reduce((acc, id) => ({ ...acc, [id]: 0 }), {});

    room.updateRoomState({
         gameActive: true,
         cardContext: generationContext,
         whiteDeck: whiteDeck, 
         blackDeck: blackDeck, 
         discardPileWhite: {}, 
         discardPileBlack: {}, 
         currentBlackCard: { id: `bc_${Date.now()}`, text: initialBlackCard },
         currentCzarId: playerIds[0], 
         roundState: 'submission', 
         submissions: {}, 
         revealOrder: [],   
         winningSubmission: null, 
         scores: initialScores,
     });

     playerIds.forEach(playerId => {
         if (playerId === room.clientId) {
              room.updatePresence({
                 hand: initialHands[playerId],
                 submittedCardId: null, 
             });
         }
     });

    console.log("Game started!");
    startGameButton.textContent = 'Start Game'; 
}

function handleSubmitCard(event) {
    const cardElement = event.currentTarget;
    const cardId = cardElement.dataset.cardId;
    const cardText = cardElement.textContent;
    const myHand = room.presence[room.clientId]?.hand || {};

    if (!cardId || !myHand[cardId]) {
        console.error("Invalid card selected.");
        return;
    }

    cardElement.classList.add('submitted');
    whiteCardsDiv.querySelectorAll('.white-card').forEach(card => {
        card.removeEventListener('click', handleSubmitCard); 
        if(card !== cardElement) card.style.cursor = 'not-allowed';
    });

    const updatedHand = { ...myHand };
    delete updatedHand[cardId];
    room.updatePresence({
        hand: updatedHand,
        submittedCardId: cardId, 
    });

    room.updateRoomState({
        submissions: {
             ...room.roomState.submissions,
             [room.clientId]: { cardId, cardText }
        }
     });

    console.log(`Submitted card: ${cardId} - ${cardText}`);
}

function handleSelectWinner(event) {
    const cardElement = event.currentTarget;
    const winningPlayerId = cardElement.dataset.playerId;
    const winningCardId = cardElement.dataset.cardId;
    const winningCardText = cardElement.textContent;
    const currentCzarId = room.roomState.currentCzarId;

    if (room.clientId !== currentCzarId || room.roomState.roundState !== 'judging') {
        console.log("Not the Czar or not judging phase.");
        return;
    }

    if (!winningPlayerId || !winningCardId) {
          console.error("Could not determine winner from clicked card.");
          return;
     }

    console.log(`Czar selected winner: ${winningPlayerId} with card ${winningCardText}`);

    const currentScores = room.roomState.scores || {};
    const winnerScore = (currentScores[winningPlayerId] || 0) + 1;

    room.updateRoomState({
         roundState: 'reveal',
         winningSubmission: {
             playerId: winningPlayerId,
             cardId: winningCardId,
             cardText: winningCardText
         },
         scores: {
             ...currentScores,
             [winningPlayerId]: winnerScore,
         }
     });
}

async function handleNextRound() {
     if (!isHost) return;
     console.log("Host starting next round...");

     const currentRoomState = room.roomState;
     const playerIds = Object.keys(room.peers);
     let whiteDeck = currentRoomState.whiteDeck || [];
     let blackDeck = currentRoomState.blackDeck || [];
     let discardPileWhite = currentRoomState.discardPileWhite || {};
     let discardPileBlack = currentRoomState.discardPileBlack || {};

     if (currentRoomState.currentBlackCard?.id) {
          discardPileBlack[currentRoomState.currentBlackCard.id] = currentRoomState.currentBlackCard.text;
     }
      Object.values(currentRoomState.submissions || {}).forEach(submission => {
          if(submission.cardId) {
             discardPileWhite[submission.cardId] = submission.cardText;
          }
     });

     if (blackDeck.length === 0) {
         console.log("Reshuffling black discard pile...");
         const discardedTexts = Object.values(discardPileBlack);
         if (discardedTexts.length === 0) {
             alert("No more black cards! Generating more...");
             const newCards = await generateCards(10, 'black', currentRoomState.cardContext || '');
             blackDeck.push(...newCards);
             if (blackDeck.length === 0) {
                 alert("Failed to generate new black cards. Game Over?");
                 room.updateRoomState({ gameActive: false });
                 return;
             }
         } else {
            blackDeck = shuffleDeck(discardedTexts);
            discardPileBlack = {}; 
         }
     }
     const nextBlackCardText = blackDeck.pop();
     const nextBlackCard = { id: `bc_${Date.now()}`, text: nextBlackCardText };

     const currentCzarIndex = playerIds.indexOf(currentRoomState.currentCzarId);
     const nextCzarIndex = (currentCzarIndex + 1) % playerIds.length;
     const nextCzarId = playerIds[nextCzarIndex];

     room.updateRoomState({
         whiteDeck: whiteDeck, 
         blackDeck: blackDeck,
         discardPileWhite: discardPileWhite,
         discardPileBlack: discardPileBlack,
         currentBlackCard: nextBlackCard,
         currentCzarId: nextCzarId,
         roundState: 'submission', 
         submissions: {}, 
         revealOrder: [],   
         winningSubmission: null, 
         // scores remain
     });

     console.log("Signaled new round. Clients should draw cards.");
}

function subscribeToUpdates() {
    room.subscribePresence((presence) => {
        console.log("Presence updated:", presence);
        updatePlayerList(); 
        if(gameStarted){
            renderHand(); 
            renderSubmissions(); 
            renderScoreboard(); 
        }
    });

    room.subscribeRoomState((currentRoomState) => {
        console.log("Room state updated:", currentRoomState);
        gameStarted = currentRoomState.gameActive || false;

        updateGameUI(); 

        const myPresence = room.presence[room.clientId] || {};
        const roundState = currentRoomState.roundState;

         if (roundState === 'submission') {
             const playerIds = Object.keys(room.peers);
             const submissions = currentRoomState.submissions || {};
             const expectedSubmissions = playerIds.length > 0 ? playerIds.length - 1 : 0; 
             const actualSubmissions = Object.keys(submissions).length;

             console.log(`Submissions: ${actualSubmissions}/${expectedSubmissions}`);


             if (playerIds.length > 0 && actualSubmissions >= expectedSubmissions && isHost) {
                 console.log("All submissions received. Moving to judging phase.");
                  const playerIdsWhoSubmitted = Object.keys(submissions);
                 const shuffledRevealOrder = shuffleDeck([...playerIdsWhoSubmitted]);

                 room.updateRoomState({
                    roundState: 'judging',
                    revealOrder: shuffledRevealOrder, 
                 });
             }
         }

         if (roundState === 'submission' && currentRoomState.currentCzarId !== room.clientId) {
              const hand = myPresence.hand || {};
              const neededCards = config.handSize - Object.keys(hand).length;

              if (neededCards > 0 && myPresence.submittedCardId) { 
                  console.log(`Need to draw ${neededCards} card(s). Attempting client-side draw.`);

                  const currentDeckState = currentRoomState.whiteDeck || []; 
                  if (currentDeckState.length >= neededCards) {
                      const newHand = { ...hand };
                      console.log(`Drawing ${neededCards} card(s) client-side.`);
                      for (let i = 0; i < neededCards; i++) {
                          const cardText = `Placeholder Drawn Card ${i+1}`; 
                          const cardId = `card_${Date.now()}_${Math.random()}`;
                          newHand[cardId] = cardText;
                      }
                      room.updatePresence({
                          hand: newHand,
                          submittedCardId: null, 
                      });
                      console.log("Client presence updated with simulated drawn cards.");
                  } else {
                      console.warn(`Client needs ${neededCards} but deck state only shows ${currentDeckState.length}. Cannot draw.`);
                      if (myPresence.submittedCardId) {
                            room.updatePresence({ submittedCardId: null });
                      }
                  }

              } else if (myPresence.submittedCardId) {
                   room.updatePresence({ submittedCardId: null });
              }

         } else if (roundState === 'submission' && currentRoomState.currentCzarId === room.clientId) {
             if(myPresence.submittedCardId){
                  room.updatePresence({ submittedCardId: null });
             }
         }
    });

    room.subscribePresenceUpdateRequests(async (updateRequest, fromClientId) => {
        console.log("Received presence update request:", updateRequest, "from", fromClientId);
    });
}

async function main() {
    try {
        await room.initialize();
        console.log("Websim initialized.");
        console.log("My client ID:", room.clientId);
        console.log("Initial peers:", room.peers);
        console.log("Initial room state:", room.roomState);
        console.log("Initial presence:", room.presence);

        updatePlayerList(); 
        updateGameUI(); 

        startGameButton.addEventListener('click', handleStartGame);
        nextRoundButton.addEventListener('click', handleNextRound);

        subscribeToUpdates();

         if (room.roomState.gameActive && !room.presence[room.clientId]?.hand) {
             console.warn("Joined mid-game, attempting to initialize hand state (basic).");
             if(!room.presence[room.clientId]) {
                room.updatePresence({ hand: {}, submittedCardId: null });
             }
         }

    } catch (error) {
        console.error("Failed to initialize Websim:", error);
        document.getElementById('app').innerHTML = '<p>Error connecting to the game room. Please try refreshing.</p>';
    }
}

main();
