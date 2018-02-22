FROM node:4-slim
RUN apt-get update && \
    apt-get install -y cron && \
    rm -f /etc/cron.daily/* && \
    apt-get clean
RUN npm install -g forever
ADD . /deploy
WORKDIR /deploy
RUN npm install
EXPOSE 3000
CMD ./run.sh
