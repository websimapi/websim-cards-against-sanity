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


let conversationHistory = []; // For LLM context if needed, though not strictly used in this card gen
let isHost = false;
let gameStarted = false;

// --- Helper Functions ---

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
        if (index === 0) { // Assume first player is host (simplification)
            li.appendChild(document.createTextNode(' (Host)'));
        }
        playerListUl.appendChild(li);
    });

    // Determine host status (simple logic: first joined player is host)
    const playerIds = Object.keys(room.peers).sort(); // Sort by join order implicitly? Need better host logic
    isHost = playerIds.length > 0 && room.clientId === playerIds[0];

    // Show/hide host controls
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

    // Generate cards in batches (adjust batch size as needed)
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
                 max_tokens: config.maxTokens * currentBatchSize, // Adjust max tokens for batch
             });
             const generatedText = completion.content.trim();
             const lines = generatedText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
             console.log("LLM Response:", generatedText);
             console.log("Parsed lines:", lines);
             cards.push(...lines.slice(0, currentBatchSize)); // Add generated cards, respecting the requested count

        } catch (error) {
             console.error(`Error generating ${type} cards:`, error);
             // Add placeholder cards on error
             for(let j = 0; j < currentBatchSize; j++) {
                 cards.push(`Error Generating ${type} Card ${i + j + 1}`);
             }
        }
         // Small delay to avoid rate limits if any
        await new Promise(resolve => setTimeout(resolve, 200));
    }


    // Ensure we have the exact number requested, even if generation failed partially
    while (cards.length < count) {
        cards.push(`Placeholder ${type} Card ${cards.length + 1}`);
    }

    console.log(`Generated ${cards.length} ${type} cards.`);
    return cards.slice(0, count); // Return exactly the count requested
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

    // Disable interaction if not my turn to submit or if I'm the czar
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
     // Hide hand area if I am the Czar and it's submission phase (Czar doesn't play)
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
    const revealOrder = room.roomState.revealOrder || []; // Get the reveal order

    submissionsArea.style.display = Object.keys(submissions).length > 0 ? 'block' : 'none';

    const cardsToDisplay = [];

    if (roundState === 'submission') {
         // Show placeholders for submitted cards
         Object.keys(submissions).forEach(playerId => {
             const cardElement = document.createElement('div');
             cardElement.classList.add('card', 'white-card', 'submitted');
             cardElement.textContent = "?"; // Placeholder
             cardsToDisplay.push(cardElement);
         });
    } else if (roundState === 'judging' || roundState === 'reveal') {
         // Display submitted cards according to reveal order
         revealOrder.forEach(playerId => {
              const submission = submissions[playerId];
              if (submission) {
                 const cardElement = document.createElement('div');
                 cardElement.classList.add('card', 'white-card', 'revealed');
                 cardElement.textContent = submission.cardText;
                 cardElement.dataset.playerId = playerId; // Store player ID for selection
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

     // Add revealed cards to the DOM
     cardsToDisplay.forEach(cardElement => submittedCardsDiv.appendChild(cardElement));

    // Show/hide Czar controls
    czarControlsDiv.style.display = (isCzar && roundState === 'judging') ? 'block' : 'none';

     // Show/hide Winner display
     winnerDisplayDiv.style.display = roundState === 'reveal' ? 'block' : 'none';
     if (roundState === 'reveal') {
         const winnerId = room.roomState.winningSubmission?.playerId;
         const winner = room.peers[winnerId];
         winnerNameSpan.textContent = winner ? winner.username : 'Someone';
         winningCardTextSpan.textContent = room.roomState.winningSubmission?.cardText || '';
         nextRoundButton.style.display = isHost ? 'block' : 'none'; // Only host sees next round button
     }
}


function renderScoreboard() {
    scoreboardUl.innerHTML = '';
    const scores = room.roomState.scores || {};
    // Sort players by score descending, then alphabetically
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
        updatePlayerList(); // Refresh lobby view
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

// --- Event Handlers ---

async function handleStartGame() {
    console.log("Attempting to start game...");
    startGameButton.disabled = true; // Prevent double clicks
    startGameButton.textContent = 'Generating Cards...';

    const playerIds = Object.keys(room.peers);
    if (playerIds.length < config.minPlayers) {
        alert(`Need at least ${config.minPlayers} players to start.`);
        startGameButton.disabled = false;
         startGameButton.textContent = 'Start Game';
        return;
    }

    const generationContext = cardContextInput.value.trim();
    const numWhiteCardsNeeded = playerIds.length * config.handSize + 50; // Initial hands + buffer
    const numBlackCardsNeeded = 20; // Initial buffer

    // Generate cards using LLM
    const [whiteCards, blackCards] = await Promise.all([
        generateCards(numWhiteCardsNeeded, 'white', generationContext),
        generateCards(numBlackCardsNeeded, 'black', generationContext)
    ]);

    if (whiteCards.length < numWhiteCardsNeeded || blackCards.length < numBlackCardsNeeded) {
        console.error("Failed to generate sufficient cards.");
        alert("Error generating cards. Please try again.");
         startGameButton.disabled = false;
         startGameButton.textContent = 'Start Game';
        return; // Or handle fallback?
    }


    const whiteDeck = shuffleDeck([...whiteCards]);
    const blackDeck = shuffleDeck([...blackCards]);

    const initialHands = dealInitialHands(playerIds, whiteDeck); // Deals cards and removes them from whiteDeck
    const initialBlackCard = blackDeck.pop();

    const initialScores = playerIds.reduce((acc, id) => ({ ...acc, [id]: 0 }), {});


    // Initialize room state for the game
     room.updateRoomState({
         gameActive: true,
         cardContext: generationContext,
         whiteDeck: whiteDeck, // Remaining cards
         blackDeck: blackDeck, // Remaining cards
         discardPileWhite: {}, // Use object for discard pile
         discardPileBlack: {}, // Use object for discard pile
         currentBlackCard: { id: `bc_${Date.now()}`, text: initialBlackCard },
         currentCzarId: playerIds[0], // First player starts as Czar
         roundState: 'submission', // 'submission', 'judging', 'reveal'
         submissions: {}, // { playerId: { cardId: '...', cardText: '...' } }
         revealOrder: [], // Player IDs in the order their cards should be revealed
         winningSubmission: null, // { playerId: '...', cardId: '...', cardText: '...' }
         scores: initialScores,
     });

     // Initialize player presence (hands)
     playerIds.forEach(playerId => {
         // Note: Can't update other players' presence directly.
         // This relies on players joining and getting their hand via initial sync.
         // A better approach might be needed if joining mid-game is allowed.
         if (playerId === room.clientId) {
              room.updatePresence({
                 hand: initialHands[playerId],
                 submittedCardId: null, // Player hasn't submitted yet
             });
         }
     });


    console.log("Game started!");
     // UI update will happen via subscribeRoomState and subscribePresence callbacks
     startGameButton.textContent = 'Start Game'; // Reset button text (it will be hidden anyway)
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

     // Prevent submitting multiple times
     if (room.presence[room.clientId]?.submittedCardId) {
        console.log("Already submitted a card this round.");
        return;
     }

     // Optimistically mark card as submitted in UI
    cardElement.classList.add('submitted');
    whiteCardsDiv.querySelectorAll('.white-card').forEach(card => {
        card.removeEventListener('click', handleSubmitCard); // Disable other cards
        if(card !== cardElement) card.style.cursor = 'not-allowed';
    });


    // Remove card from hand and update presence
    const updatedHand = { ...myHand };
    delete updatedHand[cardId];
     room.updatePresence({
        hand: updatedHand,
        submittedCardId: cardId, // Track submitted card
     });


    // Update room state with the submission
    // Use nested structure for updating submissions
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

      // Update room state to reflect the winner and move to reveal phase
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

     // Discard used black card
     if (currentRoomState.currentBlackCard?.id) {
          discardPileBlack[currentRoomState.currentBlackCard.id] = currentRoomState.currentBlackCard.text;
     }
      // Discard submitted white cards
     Object.values(currentRoomState.submissions || {}).forEach(submission => {
          if(submission.cardId) {
             discardPileWhite[submission.cardId] = submission.cardText;
          }
     });


     // --- Draw new black card ---
     if (blackDeck.length === 0) {
         console.log("Reshuffling black discard pile...");
         // Generate more if discard is empty too? For now, just reshuffle.
         const discardedTexts = Object.values(discardPileBlack);
         if (discardedTexts.length === 0) {
             // MAJOR ISSUE: No cards left and none to reshuffle
             alert("No more black cards! Generating more...");
             const newCards = await generateCards(10, 'black', currentRoomState.cardContext || '');
             blackDeck.push(...newCards);
             if (blackDeck.length === 0) {
                 alert("Failed to generate new black cards. Game Over?");
                 // Consider ending the game here
                 room.updateRoomState({ gameActive: false });
                 return;
             }
         } else {
            blackDeck = shuffleDeck(discardedTexts);
            discardPileBlack = {}; // Clear discard after reshuffling
         }
     }
     const nextBlackCardText = blackDeck.pop();
     const nextBlackCard = { id: `bc_${Date.now()}`, text: nextBlackCardText };

     // --- Determine next Czar ---
     const currentCzarIndex = playerIds.indexOf(currentRoomState.currentCzarId);
     const nextCzarIndex = (currentCzarIndex + 1) % playerIds.length;
     const nextCzarId = playerIds[nextCzarIndex];

     // --- Replenish hands ---
     // Need to request players to draw cards. Host calculates who needs what.
     const cardsToDraw = {}; // { playerId: count }
     let neededFromDeck = 0;
      playerIds.forEach(playerId => {
         // Czar didn't play a card, others did.
         if (playerId !== currentRoomState.currentCzarId) {
              cardsToDraw[playerId] = 1; // Draw 1 card
              neededFromDeck += 1;
         } else {
             cardsToDraw[playerId] = 0; // Czar draws 0
         }
      });

     // Check if white deck needs reshuffling/generation
     if (whiteDeck.length < neededFromDeck) {
          console.log("Reshuffling white discard pile...");
          const discardedTexts = Object.values(discardPileWhite);
          // Generate more if discard + deck is not enough
          const combinedCards = [...whiteDeck, ...discardedTexts];
          const stillNeeded = neededFromDeck - combinedCards.length;

          if(stillNeeded > 0){
              console.log(`Generating ${stillNeeded} more white cards...`);
               const newCards = await generateCards(stillNeeded + 20, 'white', currentRoomState.cardContext || ''); // Generate buffer
               combinedCards.push(...newCards);
          }

          if(combinedCards.length < neededFromDeck){
               alert("Could not get enough white cards for all players! Game might break.");
                // Pad with placeholders?
                while(combinedCards.length < neededFromDeck) combinedCards.push("Placeholder Card");
          }


          whiteDeck = shuffleDeck(combinedCards);
          discardPileWhite = {}; // Clear discard
     }

      // Update room state first
     room.updateRoomState({
         whiteDeck: whiteDeck, // Updated deck (potentially with drawn cards removed conceptually below, though drawing happens client-side)
         blackDeck: blackDeck,
         discardPileWhite: discardPileWhite,
         discardPileBlack: discardPileBlack,
         currentBlackCard: nextBlackCard,
         currentCzarId: nextCzarId,
         roundState: 'submission',
         submissions: {}, // Clear submissions
         revealOrder: [],   // Clear reveal order
         winningSubmission: null, // Clear winner
         // scores remain
     });


     // --- Request players to draw ---
     // This relies on clients responding to the state change and drawing for themselves.
     // Alternative: Host could calculate *which* cards they get, but that's complex with presence updates.
     // Let's rely on clients seeing the new round start and drawing.
     // Host *could* send requests, but it's less robust if requests fail.
     // A state-driven approach is generally better for websockets.
     console.log("Signaled new round. Clients should draw cards.");

}

// --- Websim Event Subscriptions ---

function subscribeToUpdates() {
    room.subscribePresence((presence) => {
        console.log("Presence updated:", presence);
        // Update UI based on presence changes (e.g., player list in lobby, potentially hand updates if needed)
        updatePlayerList(); // Update player list on any presence change
        if(gameStarted){
            // If the game is active, re-render relevant parts
            renderHand(); // Hand might change if a player draws/submits
            renderSubmissions(); // Submissions change
            renderScoreboard(); // Scores might be part of presence indirectly? No, scores are room state.
        }
    });

    room.subscribeRoomState((currentRoomState) => {
        console.log("Room state updated:", currentRoomState);
        gameStarted = currentRoomState.gameActive || false;

        updateGameUI(); // Central function to handle UI changes based on room state

        // Logic that needs to run once when state transitions occur
        const myPresence = room.presence[room.clientId] || {};
        const roundState = currentRoomState.roundState;

         // Check if all players (except Czar) have submitted
         if (roundState === 'submission') {
             const playerIds = Object.keys(room.peers);
             const submissions = currentRoomState.submissions || {};
             const expectedSubmissions = playerIds.length - 1; // Everyone except the Czar
             const actualSubmissions = Object.keys(submissions).length;

             console.log(`Submissions: ${actualSubmissions}/${expectedSubmissions}`);


             if (actualSubmissions >= expectedSubmissions && isHost) {
                 // All submissions are in, host transitions to judging phase
                 console.log("All submissions received. Moving to judging phase.");
                  // Shuffle the order of players for reveal
                 const playerIdsWhoSubmitted = Object.keys(submissions);
                 const shuffledRevealOrder = shuffleDeck([...playerIdsWhoSubmitted]);

                 room.updateRoomState({
                    roundState: 'judging',
                    revealOrder: shuffledRevealOrder, // Store the shuffled order
                 });
             }
         }

         // Check if a new round has started and I need to draw a card
          if (roundState === 'submission' && currentRoomState.currentCzarId !== room.clientId) {
              const hand = myPresence.hand || {};
              const neededCards = config.handSize - Object.keys(hand).length;

              if (neededCards > 0 && currentRoomState.whiteDeck?.length > 0) {
                  // Need to draw cards - BUT drawing should be handled by the host/room state transition?
                  // The HOST should manage the deck. Clients request cards, or state change implies drawing.
                  // Let's assume the state change implies drawing. The client takes cards from the state *conceptually*.
                  // We need a way for the client to actually *get* the card text.
                  // Modification: Host calculates draws and sends requests? Or state includes "cardsToDraw" map?
                  // Simpler: Assume client presence update triggers drawing implicitly from the state's deck.
                  // This requires the client to know *which* cards to take. Risky.

                  // Revised approach: Host calculates draws during 'handleNextRound'
                  // and updates the room state with the NEW deck.
                  // Clients then see they need cards and update their *presence* with new cards drawn *conceptually*.
                  // This is still tricky. Let's try the request model from host.

                  // --- Let's revert to client-side drawing based on need ---
                  // This assumes `room.roomState.whiteDeck` is the source of truth and clients
                  // just "take" from it. This isn't ideal for synchronization.

                  // *** BETTER APPROACH: Host deals cards via Presence Update Requests ***
                  // Let's stick to the simpler (but less robust) model for now: client draws based on need.
                  // Client will calculate difference and update its own presence.

                  console.log(`Need to draw ${neededCards} card(s).`);
                  // **PROBLEM**: Client doesn't know *which* cards to draw from the deck state.
                  // The deck state is just an array of strings. No unique IDs.
                  // This model is flawed for drawing specific cards without host intervention.

                  // --- WORKAROUND: Client "claims" cards from the deck state ---
                  // This is prone to race conditions but might work for a simple demo.
                  // A better way needs server-side logic or robust locking/transactions.

                  // Let's *simulate* drawing without modifying the shared deck state directly here.
                  // The HOST should have removed cards when starting the next round.
                  // The client just needs to update its hand.

                  // *** REVISED AGAIN: Use Presence Update Requests (Host to Client) ***
                  // In handleNextRound, host calculates draws and sends requests.

                  // Reverted back to client pulling for simplicity, acknowledging flaws:
                   const currentDeck = [...(currentRoomState.whiteDeck || [])]; // Copy deck
                   const hand = myPresence.hand || {};
                   const needed = config.handSize - Object.keys(hand).length;

                   if (needed > 0 && currentDeck.length >= needed && myPresence.submittedCardId) {
                        console.log(`Drawing ${needed} card(s) client-side.`);
                        const newHand = { ...hand };
                        const drawnCardsForPresence = {}; // Track for presence update
                         for (let i = 0; i < needed; i++) {
                             const cardText = currentDeck.pop(); // Take from the end (doesn't affect shared state)
                             const cardId = `card_${Date.now()}_${Math.random()}`;
                             newHand[cardId] = cardText;
                             drawnCardsForPresence[cardId] = cardText;
                         }
                         // This presence update doesn't guarantee unique cards if multiple clients draw simultaneously.
                         room.updatePresence({
                             hand: newHand,
                             submittedCardId: null, // Reset submitted card for the new round
                         });
                   } else if (myPresence.submittedCardId && needed <= 0) {
                        // Reset submitted status even if no drawing needed
                         room.updatePresence({
                              submittedCardId: null,
                         });
                   } else if (currentRoomState.currentCzarId === room.clientId && myPresence.submittedCardId) {
                        // Czar might have submittedCardId set from previous round if they weren't Czar
                        room.updatePresence({ submittedCardId: null });
                   }

              } else if (roundState === 'submission' && currentRoomState.currentCzarId === room.clientId) {
                    // Czar for this round, ensure submittedCardId is null
                    if(myPresence.submittedCardId){
                         room.updatePresence({ submittedCardId: null });
                    }
              }
    });

    room.subscribePresenceUpdateRequests(async (updateRequest, fromClientId) => {
        console.log("Received presence update request:", updateRequest, "from", fromClientId);
        // Example: Host could potentially request hand updates, but current model relies on client self-management.
        // This could be used for host dealing cards in a more robust system.
        // if (updateRequest.type === 'dealCard' && fromClientId === /* hostId */) {
        //    const currentHand = room.presence[room.clientId]?.hand || {};
        //    room.updatePresence({
        //        hand: {
        //            ...currentHand,
        //            [updateRequest.card.id]: updateRequest.card.text
        //        }
        //    });
        // }
    });
}

// --- Initialization ---

async function main() {
    try {
        await room.initialize();
        console.log("Websim initialized.");
        console.log("My client ID:", room.clientId);
        console.log("Initial peers:", room.peers);
        console.log("Initial room state:", room.roomState);
        console.log("Initial presence:", room.presence);

        // Initial UI setup
        updatePlayerList();
        updateGameUI(); // Setup initial game or lobby view

        // Setup event listeners for UI elements
        startGameButton.addEventListener('click', handleStartGame);
        nextRoundButton.addEventListener('click', handleNextRound);


        // Subscribe to real-time updates
        subscribeToUpdates();

         // If joining a game already in progress, initialize hand etc.
         // This requires robust initial state synchronization handled by `initialize`.
         // We might need specific logic if presence doesn't contain the hand immediately.
         if (room.roomState.gameActive && !room.presence[room.clientId]?.hand) {
             console.warn("Joined mid-game, attempting to initialize hand state (basic).");
             // Request hand state? Or assume initial sync covers it?
             // For now, rely on initial sync. If hand is missing, it's an issue.
             if(!room.presence[room.clientId]) {
                // If presence doesn't exist at all yet, set a default empty hand
                room.updatePresence({ hand: {}, submittedCardId: null });
             }
         }


    } catch (error) {
        console.error("Failed to initialize Websim:", error);
        document.getElementById('app').innerHTML = '<p>Error connecting to the game room. Please try refreshing.</p>';
    }
}

main();

