import Joi from "joi"

export const envValidation = Joi.object({
    CORS_ORIGINS: Joi.string().optional(),
    SWAGGER_ENABLED: Joi.string().valid('true', 'false').optional(),
    SEPAY_WEBHOOK_STRICT: Joi.string().valid('true', 'false').optional(),
})