# bot.py
import logging
import os
import sys

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ApplicationBuilder,
    ContextTypes,
    CommandHandler,
)

# -------------------------------
#   Настройка логирования
# -------------------------------
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)


# -------------------------------
#   Чтение переменных окружения
# -------------------------------
TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
WEBHOOK_DOMAIN = os.getenv("WEBHOOK_DOMAIN")  # например "https://my-wishlist-bot.example.com"
WEBHOOK_PORT = int(os.getenv("WEBHOOK_PORT", "8443"))  # порт для вебхуков

if not TOKEN:
    logger.error("Переменная окружения TELEGRAM_BOT_TOKEN не задана. Выход.")
    sys.exit(1)

if not WEBHOOK_DOMAIN:
    logger.error("Переменная окружения WEBHOOK_DOMAIN не задана. Выход.")
    sys.exit(1)

# Если нет переменной окружения WEBAPP_URL, по умолчанию используем ваш публичный WebApp:
DEFAULT_WEBAPP_URL = "https://wishlistme-tg.onrender.com"
WEBAPP_URL = os.getenv("WEBAPP_URL", DEFAULT_WEBAPP_URL).strip()


# -------------------------------
#   Обработчик команды /start
# -------------------------------
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    При получении команды /start отправляем пользователю приветствие и кнопку,
    которая открывает WebApp (MiniApp) по адресу WEBAPP_URL.
    """
    user = update.effective_user
    greeting = (
        f"Привет, {user.first_name}! 👋\n\n"
        "Это ваш Wishlist-MiniApp. Нажмите на кнопку ниже, чтобы открыть интерфейс вашего вишлиста."
    )

    # Inline-кнопка для открытия WebApp внутри Telegram
    keyboard = [
        [
            InlineKeyboardButton(
                text="📋 Открыть вишлист", 
                web_app={"url": WEBAPP_URL}
            )
        ]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)

    await update.message.reply_text(
        greeting,
        reply_markup=reply_markup,
    )


# -------------------------------
#   Обработчик команды /help
# -------------------------------
async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Простой хендлер для /help.
    """
    await update.message.reply_text(
        "Доступные команды:\n"
        "/start — запустить Wishlist-MiniApp\n"
        "/help — показать эту подсказку"
    )


# -------------------------------
#   Основная функция
# -------------------------------
def main() -> None:
    """
    Создаёт Application, регистрирует хендлеры и запускает бот в режиме Webhook.
    """
    # 1) Создаём Application (асинхронное приложение python-telegram-bot)
    application = (
        ApplicationBuilder()
        .token(TOKEN)
        .build()
    )

    # 2) Регистрируем хендлеры команд
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("help", help_command))

    # 3) Устанавливаем Webhook
    #
    #    Telegram будет слать POST-запросы на URL вида:
    #      https://<WEBHOOK_DOMAIN>/<TOKEN>
    #
    #    - url_path   = путь внутри приложения (здесь просто берём токен).
    #    - webhook_url= полный внешний URL, который Telegram сохранит через setWebhook.
    #
    webhook_path = TOKEN  # без слеша впереди
    webhook_url = f"{WEBHOOK_DOMAIN}/{TOKEN}"

    logger.info("Устанавливаем webhook: %s", webhook_url)

    application.run_webhook(
        listen="0.0.0.0",
        port=WEBHOOK_PORT,
        url_path=webhook_path,
        webhook_url=webhook_url,
    )


if __name__ == "__main__":
    main()
