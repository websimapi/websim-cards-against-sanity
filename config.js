export const config = {
    handSize: 7,
    minPlayers: 3,
    blackCardGenerationPrompt: `Generate a humorous, absurd, or thought-provoking question or fill-in-the-blank phrase suitable for a Cards Against Humanity style game. The phrase should contain one or more blanks indicated by underscores (__). Keep it relatively concise. Optionally, consider the context: `,
    whiteCardGenerationPrompt: `Generate a humorous, absurd, offensive, or unexpected noun or phrase suitable as an answer for a Cards Against Humanity style game. Keep it relatively concise. Optionally, consider the context: `,
    generationTemperature: 0.8, // Higher value means more creative/random
    maxTokens: 50, // Limit response length
};

