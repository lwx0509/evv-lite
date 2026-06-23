"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStripeClient = getStripeClient;
exports.getUncachableStripeClient = getUncachableStripeClient;
const stripe_1 = __importDefault(require("stripe"));
function getSecretKey() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key)
        throw new Error('STRIPE_SECRET_KEY environment variable is required');
    return key;
}
function getStripeClient() {
    return new stripe_1.default(getSecretKey());
}
async function getUncachableStripeClient() {
    return getStripeClient();
}
