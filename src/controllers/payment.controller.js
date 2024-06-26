const httpStatus = require('http-status');
const Stripe = require('stripe');
const chalk = require('chalk');
const catchAsync = require('../utils/catchAsync');
const paymentService = require('../services/payment.service');
const config = require('../config/config');

const stripe = new Stripe(config.stripe.stripeSecretKey);

const customerPortal = catchAsync(async (req, res) => {
  const { customerStripeId } = await paymentService.stripeCustomer({ user: req.user });
  if (customerStripeId) {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerStripeId,
      return_url: `${config.frontendUrl.web}/account`,
    });
    return res.status(httpStatus.OK).send(session.url);
  }
  res.status(httpStatus.BAD_REQUEST).send({ status: httpStatus.BAD_REQUEST, message: 'customer not found' });
});

const getSubscriptionMe = catchAsync(async (req, res) => {
  const subscriptions = await paymentService.getSubscriberMe(req.user.userId);
  res.status(httpStatus.OK).send({ status: httpStatus.OK, subscriptions });
});

// create or get stripe customer
const createCustomer = catchAsync(async (req, res) => {
  const customer = await paymentService.stripeCustomer({ user: req.user });
  res.status(httpStatus.OK).send({ status: httpStatus.OK, customer });
});

const createCheckoutSessions = catchAsync(async (req, res) => {
  const { customerStripeId: customerId, activeSubscription } = await paymentService.stripeCustomer({ user: req.user });
  const { subscriptionExpire } = activeSubscription;
  const expireEligible = Boolean(subscriptionExpire);

  const { session } = await paymentService.createCheckoutSessions({
    ...req.body,
    customerId,
    trialEligible: !expireEligible,
  });
  res.status(httpStatus.OK).send({ status: httpStatus.OK, session });
});

const checkoutSessions = catchAsync(async (req, res) => {
  const { sessionId } = req.query;
  const { session } = await paymentService.checkoutSession({ sessionId });
  res.status(httpStatus.OK).send({ status: httpStatus.OK, session });
});

const priceList = catchAsync(async (req, res) => {
  const activeProduct = req.query.activeProduct || true;
  const { prices } = await paymentService.PricesList({ activeProduct: !!activeProduct });
  res.status(httpStatus.OK).send({ status: httpStatus.OK, prices });
});

const updateSubscriptionPlan = catchAsync(async (req, res) => {
  const { subscriptionId, bool } = req.body;
  const { subscription } = await paymentService.updateSubscriptionPlan({ subscriptionId, bool });
  res.status(httpStatus.OK).send({ status: httpStatus.OK, subscription });
});

// const updateSubscription = catchAsync(async (req, res) => {
//   const { subscriptionId, newPriceId } = req.body;
//   const { subscription } = await paymentService.updateSubscription({ subscriptionId, newPriceId });
//   res.status(httpStatus.OK).send({ status: httpStatus.OK, subscription });
// });

// const invoicePreview = catchAsync(async (req, res) => {
//   const { customerId, priceId, subscriptionId } = req.body;
//   const { invoice } = await paymentService.invoicePreview({ customerId, priceId, subscriptionId });
//   res.status(httpStatus.OK).send({ status: httpStatus.OK, invoice });
// });

const getSubscriptions = catchAsync(async (req, res) => {
  const customer = await paymentService.findCustomer(req.user.userId);
  if (customer) {
    const { subscriptions } = await paymentService.getSubscriptions(customer.customerStripeId, req.query.status);
    return res.status(httpStatus.OK).send({ status: httpStatus.OK, subscriptions });
  }
  res.status(httpStatus.OK).send({ status: httpStatus.OK, subscription: { data: [] } });
});

const paymentWebhook = catchAsync(async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.webHookSecretKey);
  } catch (err) {
    return res
      .status(httpStatus.BAD_REQUEST)
      .send({ status: httpStatus.BAD_REQUEST, message: 'Webhook signature verification failed.' });
  }

  const dataObject = event.data.object;

  switch (event.type) {
    case 'invoice.payment_succeeded': {
      paymentService.handlePaymentSucceeded(dataObject);
      break;
    }

    case 'invoice.payment_failed': {
      paymentService.handlePaymentFailed(dataObject);
      break;
    }

    default:
      console.log(`Unhandled event type ${chalk.black.bgWhite(event.type)}`);
      break;
  }

  res.json({ received: true });
});


const handleTrialEnd = catchAsync(async (req, res) => {
  const customer = await paymentService.findCustomer(req.user.userId);
  const { freeTrial, activeSubscription } = customer;
  const { subscriptionId } = activeSubscription;

  if (freeTrial.eligible && subscriptionId) {
    await paymentService.handleTrialEnd({ subscriptionId });
    return res.status(httpStatus.OK).send({ status: httpStatus.OK, message: 'trial cancelled' });
  }
  res.status(httpStatus.BAD_REQUEST).send({ status: httpStatus.BAD_REQUEST, message: 'trial canceling failed' });
});

module.exports = {
  customerPortal,
  getSubscriptionMe,
  createCustomer,
  createCheckoutSessions,
  checkoutSessions,
  priceList,
  updateSubscriptionPlan,
  // updateSubscription,
  // invoicePreview,
  getSubscriptions,
  paymentWebhook,
  handleTrialEnd,
};
