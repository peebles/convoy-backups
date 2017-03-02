FROM node:4
RUN apt-get update && \
    apt-get install -y cron && \
    rm -f /etc/cron.daily/* && \
    apt-get clean
RUN npm install -g forever
COPY crontab /etc/crontab
ADD . /deploy
WORKDIR /deploy
EXPOSE 3000
CMD ./run.sh
