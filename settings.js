require('dotenv').config();

const settings = {
  packname: 'Night Hunter',
  author: '',
  botName: "Night Hunter",
  botOwner: 'Hoznyx', // Your name
  ownerNumber: process.env.OWNER_NUMBER || '6282329776262', // Without +, spaces, or symbols
  giphyApiKey: process.env.GIPHY_API_KEY || '',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  commandMode: "public",
  maxStoreMessages: 20,
  storeWriteInterval: 10000,
  description: "This is a bot for managing group commands and automating tasks.",
  version: "3.0.7",
  updateZipUrl: "https://github.com/Hamzah82/NightHunter/archive/refs/heads/main.zip",
};

module.exports = settings;
