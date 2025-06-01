import logging
import os
from telegram import (
    Update,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    WebAppInfo,
)
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

# Включаем логирование, чтобы видеть входящие обновления и ошибки
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", level=logging.INFO
)
logger = logging.getLogger(__name__)

# ────────────────────────────────────────────────────────────────────────────────
# ЗАДАТЬ ПАРАМЕТРЫ:
#
# 1) Вставьте ваш Telegram Bot Token (полученный от BotFather).
#    Пример: TOKEN = "123456789:AAHq8qXYZ..."
#
# 2) Укажите публичный HTTPS-URL вашего MiniApp (frontend вишлистов),
#    запущенного через туннель (LocalTunnel, Cloudflared и т.д.).
#    Согласно новой команде lt --port 3000 --subdomain wishlistme,
#    адрес будет: https://wishlistme.loca.lt
#
# Если вы планируете использовать вебхук, измените способ запуска ниже:
# вместо app.run_polling() — app.run_webhook(…)
#
TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "7741095391:AAFXS7k3ColIAcxKOCDHz6QCYmqFx4aznB8")
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://wishlistme.loca.lt")
# ────────────────────────────────────────────────────────────────────────────────


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Обработчик команды /start. Отправляет приветственное сообщение
    с кнопкой «🛒 Открыть вишлисты», которая запускает ваш WebApp.
    """
    welcome_text = (
        "Привет! 👋\n\n"
        "Это бот для управления вашими вишлистами.\n"
        "Нажмите кнопку «🛒 Открыть вишлисты», чтобы перейти в MiniApp\n"
        "и создавать или просматривать свои вишлисты прямо в браузере.\n\n"
        "Если что-то пойдет не так, дайте знать!"
    )

    keyboard = [
        [
            InlineKeyboardButton(
                text="🛒 Открыть вишлисты",
                web_app=WebAppInfo(WEBAPP_URL),
            )
        ]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)

    await update.message.reply_text(
        text=welcome_text,
        reply_markup=reply_markup
    )


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Обработчик команды /help. Простой текст с подсказками.
    """
    help_text = (
        "Этот бот связан с вашим MiniApp для вишлистов.\n\n"
        "1. Напишите /start, чтобы получить кнопку «Открыть вишлисты».\n"
        "2. Нажмите на кнопку, и в браузере откроется ваш MiniApp.\n"
        "3. В самом MiniApp будете создавать/редактировать свои вишлисты.\n\n"
        "Дополнительные команды пока не предусмотрены."
    )
    await update.message.reply_text(help_text)


async def echo(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Обработчик всех прочих текстовых сообщений, если нужно что-то отобразить
    или просто отвечать «неизвестная команда». Здесь мы отвечаем односложным текстом.
    """
    await update.message.reply_text(
        "Извините, я пока понимаю только /start и /help. Пожалуйста, нажмите кнопку «Открыть вишлисты»."
    )


def main() -> None:
    """
    Точка входа: создаем приложение, регистрируем хендлеры и запускаем polling.
    При желании можно заменить run_polling() на run_webhook(), если вы хотите
    развернуть бота на сервере с собственным сертификатом.
    """
    # Проверка: токен не должен быть значением по умолчанию
    if TOKEN == "ВАШ_TELEGRAM_BOT_TOKEN_ЗДЕСЬ" or not TOKEN.strip():
        logger.error("Пожалуйста, задайте корректный TELEGRAM_BOT_TOKEN перед запуском.")
        return

    # Проверка: WEBAPP_URL должен начинаться с https://
    if not WEBAPP_URL.startswith("https://"):
        logger.error(
            "WEBAPP_URL должен быть публичным HTTPS адресом вашего MiniApp, "
            "например: https://wishlistme.loca.lt"
        )
        return

    # Строим приложение (бот)
    app = ApplicationBuilder().token(TOKEN).build()

    # Регистрируем хендлеры:
    # - /start → кнопка WebApp
    app.add_handler(CommandHandler("start", start))
    # - /help → подсказка
    app.add_handler(CommandHandler("help", help_command))
    # - любой другой текст → echo (сообщаем, что мы понимаем пока только /start и /help)
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, echo))

    # Запуск polling:
    logger.info("Запуск бота (polling)...")
    app.run_polling()

    # Если вы захотите настроить webhook (на VPS с HTTPS), замените последнюю строку на:
    # app.run_webhook(
    #     listen="0.0.0.0",
    #     port=int(os.getenv("PORT", "8443")),
    #     url_path=TOKEN,
    #     webhook_url=f"https://<ВАШ_ДОМЕН>/webhook/{TOKEN}"
    # )


if __name__ == "__main__":
    main()
